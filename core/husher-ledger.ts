import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {z} from 'zod';
import {husherCreationIntentSchema,type HusherIntentStore,type HusherCreationIntent} from './husher-order-intent';

const scopeSchema=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
export const husherSubmissionRecord=z.object({
 version:z.literal(1),fingerprint:hash,orderId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
 nonceKey:z.string().regex(/^1:0x[0-9a-f]{40}:[0-9]+$/),hash,
 request:z.unknown(),response:z.unknown(),wallet:z.unknown(),
 state:z.literal('submission-uncertain'),createdAt:z.string().datetime(),
}).strict();
export type HusherSubmissionRecord=z.infer<typeof husherSubmissionRecord>;

// Namespace/scope are trusted server configuration, never request parameters.
export class HusherLedger implements HusherIntentStore {
 private sql:NeonQueryFunction<false,false>;
 private ns:'drivekey_husher'|'drivekey_husher_test';
 private scope:string;
 constructor(url:string,scope:string,namespace:'drivekey_husher'|'drivekey_husher_test'='drivekey_husher'){
  const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname.endsWith('.neon.tech'))throw Error('Unsupported private ledger configuration.');
  this.scope=scopeSchema.parse(scope);if(!['drivekey_husher','drivekey_husher_test'].includes(namespace))throw Error('Invalid ledger namespace.');
  this.ns=namespace;this.sql=neon(url);
 }
 private async query(query:string,args:unknown[]=[]){
  try{return await this.sql.query(query,args);}catch{throw Error('Durable Husher ledger operation failed. Reconcile saved intent; do not retry provider creation or submission.');}
 }
 async reserveOnce(input:HusherCreationIntent,limit:'1000000000'){
  if(limit!=='1000000000')throw Error('Unsupported allowance.');const r=husherCreationIntentSchema.parse(input);
  const rows=await this.query(`select ${this.ns}.reserve($1,$2::jsonb) as result`,[this.scope,JSON.stringify(r)]);
  const v=z.object({inserted:z.boolean(),intent:husherCreationIntentSchema}).parse(rows[0]?.result);return v;
 }
 async read(id:string){z.string().uuid().parse(id);const rows=await this.query(`select document from ${this.ns}.intent where scope=$1 and id=$2`,[this.scope,id]);return rows.length?husherCreationIntentSchema.parse(rows[0].document):null;}
 async creations(){const rows=await this.query(`select document from ${this.ns}.intent where scope=$1 order by created_at desc limit 100`,[this.scope]);return rows.map(r=>husherCreationIntentSchema.parse(r.document));}
 async prepared(id:string){z.string().uuid().parse(id);const rows=await this.query(`select document from ${this.ns}.prepared where scope=$1 and id=$2`,[this.scope,id]);return rows[0]?.document??null;}
 async savePrepared(id:string,document:unknown){z.string().uuid().parse(id);await this.query(`insert into ${this.ns}.prepared(scope,id,document) values($1,$2,$3::jsonb) on conflict(scope,id) do nothing`,[this.scope,id,JSON.stringify(document)]);return this.prepared(id);}
 async markCreated(id:string,fingerprint:string,orderId:string){z.string().uuid().parse(id);hash.parse(fingerprint);z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).parse(orderId);await this.query(`select ${this.ns}.created($1,$2,$3,$4)`,[this.scope,id,fingerprint,orderId]);}
 async allowance(){const rows=await this.query(`select a.month,a.baseline::text,a.ceiling::text,a.enabled,coalesce(sum(i.reserved),0)::text as reserved from ${this.ns}.allowance a left join ${this.ns}.intent i using(scope,month) where a.scope=$1 and a.month=to_char(now() at time zone 'UTC','YYYY-MM') group by a.scope,a.month`,[this.scope]);if(rows.length!==1)throw Error('Monthly allowance needs reconciliation.');return rows[0];}
 async claimSubmission(id:string,input:unknown){z.string().uuid().parse(id);const r=husherSubmissionRecord.parse(input);const rows=await this.query(`select ${this.ns}.claim_submission($1,$2,$3::jsonb) as inserted`,[this.scope,id,JSON.stringify(r)]);return rows[0]?.inserted===true;}
 async submission(fingerprint:string){hash.parse(fingerprint);const rows=await this.query(`select document from ${this.ns}.submission where scope=$1 and fingerprint=$2`,[this.scope,fingerprint]);return rows.length?husherSubmissionRecord.parse(rows[0].document):null;}
 async history(){const rows=await this.query(`select document from ${this.ns}.submission where scope=$1 order by created_at desc limit 100`,[this.scope]);return rows.map(r=>husherSubmissionRecord.parse(r.document));}
 async claimPayout(orderId:string,transactionHash:string,logIndex:number){z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).parse(orderId);hash.parse(transactionHash);z.number().int().nonnegative().safe().parse(logIndex);
  await this.query(`insert into ${this.ns}.payout_claim(scope,order_id,hash,log_index) values($1,$2,$3,$4) on conflict(scope,hash,log_index) do nothing`,[this.scope,orderId,transactionHash,logIndex]);
  const rows=await this.query(`select order_id from ${this.ns}.payout_claim where scope=$1 and hash=$2 and log_index=$3`,[this.scope,transactionHash,logIndex]);if(rows[0]?.order_id!==orderId)throw Error('Payout evidence is already associated with another order.');
 }
 async createSession(digest:string,expiresAt:Date){z.string().regex(/^[0-9a-f]{64}$/).parse(digest);if(expiresAt.getTime()<=Date.now()||expiresAt.getTime()>Date.now()+3600000)throw Error('Invalid session expiry.');await this.query(`insert into ${this.ns}.owner_session(scope,digest,expires_at) values($1,$2,$3)`,[this.scope,digest,expiresAt.toISOString()]);}
 async hasSession(digest:string){z.string().regex(/^[0-9a-f]{64}$/).parse(digest);const rows=await this.query(`select 1 from ${this.ns}.owner_session where scope=$1 and digest=$2 and expires_at>now()`,[this.scope,digest]);return rows.length===1;}
 async endSession(digest:string){z.string().regex(/^[0-9a-f]{64}$/).parse(digest);await this.query(`delete from ${this.ns}.owner_session where scope=$1 and digest=$2`,[this.scope,digest]);}
}
