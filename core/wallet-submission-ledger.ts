import {OperationalError} from './service-events';
import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {z} from 'zod';
import bs58 from 'bs58';

const hex=z.string().regex(/^0x[0-9a-f]{64}$/);
const address=z.string().regex(/^0x[0-9a-f]{40}$/);
const integer=z.number().int().nonnegative().safe();
const base58=(bytes:number)=>z.string().max(bytes===64?88:44).refine(value=>{try{return bs58.decode(value).length===bytes&&bs58.encode(bs58.decode(value))===value;}catch{return false;}},'Invalid canonical base58 identity');
const key=base58(32),signature=base58(64);
const common={version:z.literal(1),protocolVersion:z.number().int().min(1).max(32),fingerprint:hex,signedBytesDigest:hex,expiresAt:z.string().max(64).datetime()};
export const walletSubmissionClaimSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('evm'),purpose:z.enum(['transfer','approval','swap','weth-conversion']),chainId:z.number().int().positive().safe(),from:address,nonce:integer,hash:hex}).strict(),
 z.object({...common,kind:z.literal('solana-durable'),purpose:z.enum(['transfer','swap','nonce-invalidate']),genesis:key,from:key,signature,nonceAccount:key,nonceValue:key,authority:key}).strict(),
 z.object({...common,kind:z.literal('solana-setup'),purpose:z.literal('nonce-setup'),genesis:key,from:key,signature,destination:key,authority:key,blockhash:key,lastValidBlockHeight:integer}).strict(),
]);
export type WalletSubmissionClaim=z.infer<typeof walletSubmissionClaimSchema>;
export const walletSubmissionIdentitySchema=z.discriminatedUnion('family',[
 z.object({family:z.literal('evm'),chainId:z.number().int().positive().safe(),hash:hex}).strict(),
 z.object({family:z.literal('solana'),genesis:key,signature}).strict(),
]);
export type WalletSubmissionIdentity=z.infer<typeof walletSubmissionIdentitySchema>;
export interface WalletSubmissionStore{read(identity:WalletSubmissionIdentity):Promise<WalletSubmissionClaim|null>;claim(record:WalletSubmissionClaim):Promise<boolean>;}
export function walletSubmissionIdentity(record:WalletSubmissionClaim):WalletSubmissionIdentity{
 const r=walletSubmissionClaimSchema.parse(record);return r.kind==='evm'?{family:'evm',chainId:r.chainId,hash:r.hash}:{family:'solana',genesis:r.genesis,signature:r.signature};
}
function keyFor(identity:WalletSubmissionIdentity){return identity.family==='evm'?{network:'evm:'+identity.chainId,id:identity.hash}:{network:'solana:'+identity.genesis,id:identity.signature};}
const errorMessage='Durable wallet submission claim unavailable. Reconcile the original intent; do not broadcast or retry.';
// Storage only: callers MUST derive every identity/digest from verified exact signed
// bytes, perform fresh preflight and release checks, then claim before broadcast.
// No TTL, delete, update, release or implicit retry. No raw transactions are stored.
export class WalletSubmissionLedger implements WalletSubmissionStore{
 private readonly sql:NeonQueryFunction<false,false>;
 private readonly scope:string;
 private readonly namespace:'drivekey_wallet_submission'|'drivekey_wallet_submission_test';
 constructor(url:string,scope:string,namespace:'drivekey_wallet_submission'|'drivekey_wallet_submission_test'='drivekey_wallet_submission'){
  try{const parsed=new URL(url);if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname.endsWith('.neon.tech')||!/^[a-zA-Z0-9_-]{1,80}$/.test(scope)||!['drivekey_wallet_submission','drivekey_wallet_submission_test'].includes(namespace))throw Error();this.scope=scope;this.namespace=namespace;this.sql=neon(url);}
  catch{throw Error('Unsupported private wallet submission ledger configuration.');}
 }
 async read(identity:WalletSubmissionIdentity):Promise<WalletSubmissionClaim|null>{
  const expected=keyFor(walletSubmissionIdentitySchema.parse(identity));
  try{const rows=await this.sql.query(`select document from ${this.namespace}.claim where scope=$1 and network=$2 and transaction_identity=$3`,[this.scope,expected.network,expected.id],{fetchOptions:{signal:AbortSignal.timeout(5000)}});if(!rows.length)return null;if(rows.length!==1)throw Error();const record=walletSubmissionClaimSchema.parse(rows[0].document);const actual=keyFor(walletSubmissionIdentity(record));if(actual.network!==expected.network||actual.id!==expected.id)throw Error();return record;}catch{throw new OperationalError(errorMessage,'storage-unavailable');}
 }
 async claim(input:WalletSubmissionClaim):Promise<boolean>{
  const record=walletSubmissionClaimSchema.parse(input),expected=keyFor(walletSubmissionIdentity(record));
  try{const rows=await this.sql.query(`insert into ${this.namespace}.claim(scope,document) values($1,$2::jsonb) on conflict do nothing returning network,transaction_identity,document`,[this.scope,JSON.stringify(record)],{fetchOptions:{signal:AbortSignal.timeout(5000)}});if(!rows.length)return false;if(rows.length!==1||rows[0].network!==expected.network||rows[0].transaction_identity!==expected.id)throw Error();const returned=walletSubmissionClaimSchema.parse(rows[0].document);if(JSON.stringify(returned)!==JSON.stringify(record))throw Error();return true;}catch{throw new OperationalError(errorMessage,'storage-unavailable');}
 }
}
