import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getAddress } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { CHAINS, Chain, canonical } from '../engine/core/payment-intent';
export interface DB { query(sql:string,params?:any[]):Promise<{rows:any[];rowCount?:number|null}> }
export type Evidence={chain:Chain;asset:string;recipient:string;amount:string;transactionHash:string;eventIndex:number;chainTime:string;canonical:boolean;proof:any};
const invoiceInput=z.object({chain:z.enum(['ethereum','sepolia','solana','devnet']),asset:z.enum(['ETH','SOL','USDC']),amount:z.string().regex(/^[1-9][0-9]*$/).max(38),expiresInSeconds:z.number().int().min(60).max(86400)}).strict();
export function normalizeAddress(chain:Chain,address:string){return CHAINS[chain].family==='ethereum'?getAddress(address).toLowerCase():new PublicKey(address).toBase58();}
export function invoiceStatus(amount:bigint,paid:bigint,late:bigint,expired:boolean,reorg:boolean){
 if(reorg)return 'review-reorg';if(paid>=amount)return paid>amount?'overpaid':'paid';if(late>0n)return 'late-payment';if(paid>0n)return 'underpaid';return expired?'expired':'open';
}
export class CheckoutService {
 constructor(readonly db:DB,readonly verify:(invoice:any,hash:string)=>Promise<Evidence[]>,readonly clock=()=>new Date()){}
 async provision(chain:Chain,addresses:string[]){if(!CHAINS[chain]||!Array.isArray(addresses)||addresses.length<1||addresses.length>1000)throw Error('Invalid address pool.');for(const a of addresses){const address=normalizeAddress(chain,a);if(/^0x0{40}$/.test(address))throw Error('Zero address forbidden.');await this.db.query('INSERT INTO address_pool(chain,address) VALUES($1,$2) ON CONFLICT DO NOTHING',[chain,address]);}}
 async create(input:unknown,key:string){
  const p=invoiceInput.parse(input);if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw Error('Invalid idempotency key.');const c=CHAINS[p.chain];if(p.asset!==c.native&&p.asset!=='USDC')throw Error('Asset and network mismatch.');
  const digest=createHash('sha256').update(canonical(p)).digest('hex');const old=(await this.db.query('SELECT * FROM invoices WHERE idempotency_key=$1',[key])).rows[0];if(old){if(old.request_digest!==digest)throw Error('Idempotency key conflicts with another invoice.');return old;}
  // One statement atomically allocates an address and creates its only invoice.
  const created=new Date(Math.floor(this.clock().getTime()/1000)*1000),expires=new Date(created.getTime()+p.expiresInSeconds*1000);
  const result=await this.db.query(`WITH candidate AS (
   SELECT p.chain,p.address FROM address_pool p WHERE p.chain=$1 AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.chain=p.chain AND i.address=p.address)
   ORDER BY p.address LIMIT 1 FOR UPDATE OF p SKIP LOCKED
  ) INSERT INTO invoices(id,public_token,idempotency_key,request_digest,chain,asset,amount,address,created_at,expires_at)
  SELECT $2,$3,$4,$5,chain,$6,$7,address,$8,$9 FROM candidate ON CONFLICT DO NOTHING RETURNING *`,[p.chain,randomUUID(),randomBytes(32).toString('hex'),key,digest,p.asset,p.amount,created.toISOString(),expires.toISOString()]);
  if(result.rows[0])return result.rows[0];const concurrent=(await this.db.query('SELECT * FROM invoices WHERE idempotency_key=$1',[key])).rows[0];if(concurrent&&concurrent.request_digest===digest)return concurrent;throw Error('No unallocated receiving address or conflicting concurrent request. Retry with the same idempotency key.');
 }
 async get(token:string){if(!/^[0-9a-f]{64}$/.test(token))throw Error('Invoice not found.');const r=(await this.db.query('SELECT * FROM invoices WHERE public_token=$1',[token])).rows[0];if(!r)throw Error('Invoice not found.');return this.refresh(r.id);}
 async refresh(id:string,retries=0):Promise<any>{
  if(retries>8)throw Error('Concurrent invoice update; retry status.');
  // Serialize all state/outbox changes per invoice in one statement. No in-memory transaction state.
  const result=await this.db.query(`WITH totals AS (
   SELECT i.id,COALESCE(sum(p.amount) FILTER(WHERE p.canonical AND p.chain_time<=i.expires_at AND p.chain_time>=i.created_at),0) AS paid,
   COALESCE(sum(p.amount) FILTER(WHERE p.canonical AND p.chain_time>i.expires_at),0) AS late,
   COALESCE(bool_or(NOT p.canonical),false) AS reorg FROM invoices i LEFT JOIN payment_claims p ON p.invoice_id=i.id WHERE i.id=$1 GROUP BY i.id
  ) SELECT i.*,t.paid::text AS total_paid,t.late::text AS total_late,t.reorg FROM invoices i JOIN totals t ON t.id=i.id`,[id]);
  let r=result.rows[0];if(!r)throw Error('Invoice not found.');const state=invoiceStatus(BigInt(r.amount),BigInt(r.total_paid),BigInt(r.total_late),this.clock().getTime()>new Date(r.expires_at).getTime(),r.reorg);
  if(state!==r.status||BigInt(r.paid)!==BigInt(r.total_paid)||BigInt(r.late)!==BigInt(r.total_late)){
   const next=r.revision+1,eventId=randomUUID();const body=JSON.stringify({id:eventId,type:'invoice.'+state,invoiceId:r.id,revision:next,chain:r.chain,asset:r.asset,amount:String(r.amount),paid:r.total_paid,late:r.total_late,status:state});
   const update=await this.db.query(`WITH updated AS (UPDATE invoices SET status=$2,paid=$3,late=$7,revision=revision+1 WHERE id=$1 AND revision=$4 RETURNING *)
    INSERT INTO webhook_outbox(id,invoice_id,revision,body) SELECT $5,id,revision,$6 FROM updated RETURNING invoice_id`,[id,state,r.total_paid,r.revision,eventId,body,r.total_late]);
   if(!update.rows.length)return this.refresh(id,retries+1);
   r={...r,status:state,paid:r.total_paid,late:r.total_late,revision:next};
  }return r;
 }
 async observe(token:string,hash:string){
  const invoice=await this.get(token);if(typeof hash!=='string'||hash.length>100)throw Error('Invalid transaction hash.');const entries=await this.verify(invoice,hash);if(!entries.length)throw Error('No matching finalized payment.');
  for(const e of entries){
   if(e.chain!==invoice.chain||e.asset!==invoice.asset||normalizeAddress(e.chain,e.recipient)!==invoice.address||e.transactionHash!==hash||!Number.isSafeInteger(e.eventIndex)||e.eventIndex<0||!/^\d+$/.test(e.amount)||BigInt(e.amount)<=0n||!Number.isFinite(Date.parse(e.chainTime)))throw Error('Settlement evidence differs from invoice.');
   const claim=await this.db.query(`INSERT INTO payment_claims(chain,tx_hash,event_index,invoice_id,amount,chain_time,canonical,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(chain,tx_hash,event_index) DO UPDATE SET canonical=EXCLUDED.canonical,evidence=EXCLUDED.evidence
    WHERE payment_claims.invoice_id=EXCLUDED.invoice_id AND payment_claims.amount=EXCLUDED.amount AND payment_claims.chain_time=EXCLUDED.chain_time
    RETURNING invoice_id`,[e.chain,hash,e.eventIndex,invoice.id,e.amount,e.chainTime,e.canonical,JSON.stringify(e.proof)]);
   if(!claim.rows.length)throw Error('Payment already claimed or evidence changed.');
  }return this.refresh(invoice.id);
 }
}
export function webhookSignature(secret:string,timestamp:string,body:string){if(secret.length<32)throw Error('Webhook secret too short.');return createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');}
export function verifyWebhook(secret:string,timestamp:string,body:string,signature:string,now=Date.now()){
 if(!/^\d{10,13}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||! /^[0-9a-f]{64}$/.test(signature))return false;
 return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(webhookSignature(secret,timestamp,body),'hex'));
}
export async function deliverWebhook(db:DB,url:string,secret:string,send=fetch,now=Date.now()){
 const u=new URL(url);if(u.protocol!=='https:')throw Error('Webhook URL must use HTTPS.');
 const row=(await db.query(`WITH due AS (SELECT id FROM webhook_outbox WHERE delivered_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE webhook_outbox o SET lease_until=now()+interval '60 seconds',attempts=attempts+1 FROM due WHERE o.id=due.id RETURNING o.*`)).rows[0];if(!row)return false;
 const t=String(Math.floor(now/1000));let success=false;
 try{const response=await send(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-drivekey-event':row.id,'x-drivekey-timestamp':t,'x-drivekey-signature':webhookSignature(secret,t,row.body)},body:row.body});success=response.ok;await response.body?.cancel();}catch{}
 if(success)await db.query('UPDATE webhook_outbox SET delivered_at=now(),lease_until=NULL WHERE id=$1',[row.id]);
 else await db.query("UPDATE webhook_outbox SET available_at=now()+($2 * interval '1 second'),lease_until=NULL WHERE id=$1",[row.id,Math.min(86400,2**Math.min(row.attempts,16))]);return true;
}
