import {OperationalError} from './service-events';
import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {z} from 'zod';

const hashSchema=z.string().regex(/^0x[0-9a-f]{64}$/);
export const lifiSubmissionRecordSchema=z.object({
 version:z.literal(1),chainId:z.literal(1),from:z.string().regex(/^0x[0-9a-f]{40}$/),
 nonce:z.number().int().nonnegative().safe(),hash:hashSchema,fingerprint:hashSchema,
}).strict();
export type LifiSubmissionRecord=z.infer<typeof lifiSubmissionRecordSchema>;
export interface LifiSubmissionStore {
 read(hash:string):Promise<LifiSubmissionRecord|null>;
 claim(record:LifiSubmissionRecord):Promise<boolean>;
}

const failure='Durable LI.FI submission ledger unavailable. Reconcile the saved transaction; do not broadcast or retry submission.';
// The scope and namespace are trusted server configuration, never client input.
// A claim records intent BEFORE broadcast. It deliberately has no TTL, release or retry API.
export class LifiSubmissionLedger implements LifiSubmissionStore {
 private readonly sql:NeonQueryFunction<false,false>;
 private readonly scope:string;
 private readonly namespace:'drivekey_lifi'|'drivekey_lifi_test';
 constructor(url:string,scope:string,namespace:'drivekey_lifi'|'drivekey_lifi_test'='drivekey_lifi'){
  try{
   const parsed=new URL(url);
   if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname.endsWith('.neon.tech'))throw Error();
   if(!/^[a-zA-Z0-9_-]{1,80}$/.test(scope)||!['drivekey_lifi','drivekey_lifi_test'].includes(namespace))throw Error();
   this.scope=scope;this.namespace=namespace;this.sql=neon(url);
  }catch{throw Error('Unsupported private LI.FI ledger configuration.');}
 }
 async read(hash:string):Promise<LifiSubmissionRecord|null>{
  hashSchema.parse(hash);
  try{
   const rows=await this.sql.query(`select version,chain_id as "chainId",sender as "from",nonce::text,hash,fingerprint from ${this.namespace}.submission where scope=$1 and hash=$2`,[this.scope,hash],{fetchOptions:{signal:AbortSignal.timeout(5000)}});
   if(rows.length===0)return null;
   if(rows.length!==1)throw Error();
   const record=lifiSubmissionRecordSchema.parse({...rows[0],nonce:Number(rows[0].nonce)});
   if(record.hash!==hash)throw Error();
   return record;
  }catch{throw new OperationalError(failure,'storage-unavailable');}
 }
 async claim(input:LifiSubmissionRecord):Promise<boolean>{
  const r=lifiSubmissionRecordSchema.parse(input);
  try{
   const rows=await this.sql.query(`insert into ${this.namespace}.submission(scope,version,chain_id,sender,nonce,hash,fingerprint) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning hash`,[this.scope,r.version,r.chainId,r.from,r.nonce,r.hash,r.fingerprint],{fetchOptions:{signal:AbortSignal.timeout(5000)}});
   if(rows.length===0)return false;
   if(rows.length!==1||rows[0].hash!==r.hash)throw Error();
   return true;
  }catch{throw new OperationalError(failure,'storage-unavailable');}
 }
}
