import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {z} from 'zod';
import {PublicKey} from '@solana/web3.js';
import type {JupiterNonceLifecycle} from './jupiter-expiring-online';
import {OperationalError} from './service-events';
const key=z.string().max(44).refine(v=>{try{return new PublicKey(v).toBase58()===v;}catch{return false;}});
export const jupiterNonceReservationSchema=z.object({genesis:key,owner:key,nonceAccount:key,nonceValue:key,requestFingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),expiresAt:z.string().max(64).datetime()}).strict();
export type JupiterNonceReservation=z.infer<typeof jupiterNonceReservationSchema>;
const identitySchema=jupiterNonceReservationSchema.omit({requestFingerprint:true,expiresAt:true});
// Private operator-only storage. Never invoke reserve for an unauthenticated
// public-wallet request: public addresses do not prove authority to lock a nonce.
// No expiry deletion or release operation: a changed finalized nonce is required.
export class JupiterNonceLedger implements JupiterNonceLifecycle{
 private readonly sql:NeonQueryFunction<false,false>;
 constructor(url:string,private readonly scope:string){
  const parsed=new URL(url);if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname.endsWith('.neon.tech')||!/^[a-zA-Z0-9_-]{1,80}$/.test(scope))throw Error('Unsupported private nonce journal configuration.');this.sql=neon(url);
 }
 async assertAvailable(input:z.infer<typeof identitySchema>){
  const r=identitySchema.parse(input);
  let rows;
  try{rows=await this.sql.query('select document from drivekey_wallet_submission.jupiter_nonce_reservation where scope=$1 and genesis=$2 and nonce_account=$3 and nonce_value=$4',[this.scope,r.genesis,r.nonceAccount,r.nonceValue],{fetchOptions:{signal:AbortSignal.timeout(5000)}});}catch{throw new OperationalError('Private nonce journal unavailable. Reconcile the original approval; do not retry preparation.','storage-unavailable');}
  if(rows.length)throw Error('Nonce unresolved. Reconcile or invalidate the previous approval before preparing another swap.');
 }
 async reserve(input:JupiterNonceReservation){
  const r=jupiterNonceReservationSchema.parse(input);
  try{
  const rows=await this.sql.query('insert into drivekey_wallet_submission.jupiter_nonce_reservation(scope,document) values($1,$2::jsonb) on conflict do nothing returning document',[this.scope,JSON.stringify(r)],{fetchOptions:{signal:AbortSignal.timeout(5000)}});
  if(!rows.length)return false;if(rows.length!==1)throw Error('Nonce journal acknowledgement invalid.');
  const returned=jupiterNonceReservationSchema.parse(rows[0].document);
  if(Object.entries(r).some(([key,value])=>returned[key as keyof JupiterNonceReservation]!==value))throw Error('Nonce journal acknowledgement invalid.');
  return true;
  }catch{throw new OperationalError('Private nonce journal acknowledgement unavailable. Reconcile the original approval; do not retry preparation.','storage-unavailable');}
 }
}
