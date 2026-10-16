import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {z} from 'zod';
import {walletSubmissionClaimSchema,walletSubmissionIdentitySchema,type WalletSubmissionClaim,type WalletSubmissionIdentity} from './wallet-submission-ledger';

export type SetupClaim=Extract<WalletSubmissionClaim,{kind:'solana-setup'}>;
export const setupResolutionSchema=z.object({
 version:z.literal(1),reason:z.enum(['finalized-failure','finalized-expiry']),
 observedAt:z.string().datetime(),finalizedHeight:z.number().int().nonnegative().safe(),
 destinationAbsent:z.literal(true),signatureAbsent:z.boolean(),blockhashInvalid:z.boolean(),
}).strict();
export type SetupResolution=z.infer<typeof setupResolutionSchema>;
// A caller derives resolution ONLY from its own fresh RPC reads, never request flags.
export interface NonceSetupStore {
 read(identity:WalletSubmissionIdentity):Promise<WalletSubmissionClaim|null>;
 claim(record:SetupClaim):Promise<boolean>;
 resolve(record:SetupClaim,evidence:SetupResolution):Promise<boolean>;
}
export class NonceSetupLedger implements NonceSetupStore {
 private readonly sql:NeonQueryFunction<false,false>;
 constructor(url:string,private readonly scope:string){
  const p=new URL(url);
  if(!['postgres:','postgresql:'].includes(p.protocol)||!p.hostname.endsWith('.neon.tech')||!/^[a-zA-Z0-9_-]{1,80}$/.test(scope))throw Error('Unsupported setup journal configuration.');
  this.sql=neon(url);
 }
 private async query(text:string,values:unknown[]){try{return await this.sql.query(text,values,{fetchOptions:{signal:AbortSignal.timeout(5000)}});}catch{throw Error('Setup journal unavailable. Reconcile the saved attempt; do not retry.');}}
 async read(value:WalletSubmissionIdentity){
  const id=walletSubmissionIdentitySchema.parse(value);if(id.family!=='solana')throw Error('Wrong setup journal network.');
  const rows=await this.query('select document from drivekey_wallet_submission.setup_attempt where scope=$1 and network=$2 and transaction_identity=$3 union select document from drivekey_wallet_submission.claim where scope=$1 and network=$2 and transaction_identity=$3',[this.scope,'solana:'+id.genesis,id.signature]);
  if(!rows.length)return null;if(rows.length!==1)throw Error('Conflicting setup journal records.');
  const r=walletSubmissionClaimSchema.parse(rows[0].document);
  if(r.kind!=='solana-setup'||r.genesis!==id.genesis||r.signature!==id.signature)throw Error('Wrong setup journal identity.');return r;
 }
 async claim(value:SetupClaim){
  const r=walletSubmissionClaimSchema.parse(value);if(r.kind!=='solana-setup')throw Error('Wrong setup claim.');
  const rows=await this.query('select drivekey_wallet_submission.claim_setup($1,$2::jsonb) as accepted',[this.scope,JSON.stringify(r)]);
  if(rows.length!==1||typeof rows[0].accepted!=='boolean')throw Error('Setup claim was not acknowledged.');return rows[0].accepted;
 }
 async resolve(value:SetupClaim,input:SetupResolution){
  const r=walletSubmissionClaimSchema.parse(value),e=setupResolutionSchema.parse(input);
  if(r.kind!=='solana-setup'||e.reason==='finalized-expiry'&&(!e.signatureAbsent||!e.blockhashInvalid||e.finalizedHeight<=r.lastValidBlockHeight)||e.reason==='finalized-failure'&&e.signatureAbsent)throw Error('Insufficient setup resolution evidence.');
  const rows=await this.query('select drivekey_wallet_submission.resolve_setup($1,$2::jsonb,$3::jsonb) as accepted',[this.scope,JSON.stringify(r),JSON.stringify(e)]);
  if(rows.length!==1||typeof rows[0].accepted!=='boolean')throw Error('Setup resolution was not acknowledged.');return rows[0].accepted;
 }
}
