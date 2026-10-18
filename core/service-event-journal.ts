import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {z} from 'zod';
import {validateOperationalEvent} from './service-alerts';
const sequence=z.number().int().min(0).max(10000),time=z.number().int().nonnegative().safe();
const pageSchema=z.object({sourceId:z.string().uuid(),head:sequence,observedAt:time,readAt:time,captureEnabled:z.boolean(),records:z.array(z.object({sequence:sequence.min(1),observedAt:time,event:z.unknown()}).strict()).max(100)}).strict();
export class PostgresServiceEventJournal{
 private readonly sql:NeonQueryFunction<false,false>;
 constructor(url:string,readonly sourceId:string){
  const u=new URL(url);z.string().uuid().parse(sourceId);
  if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname.endsWith('.neon.tech'))throw Error('Invalid private event journal configuration.');
  this.sql=neon(url);
 }
 private async query(sql:string,args:unknown[]){
  try{return await this.sql.query(sql,args,{fetchOptions:{signal:AbortSignal.timeout(5000)}});}catch{throw Error('Event journal unavailable; ingestion state unknown.');}
 }
 async append(input:unknown){
  const event=validateOperationalEvent(input),body=JSON.stringify(event);
  if(Buffer.byteLength(body)>2048)throw Error('Oversized event.');
  const rows=await this.query('select sequence::text,observed_at::text from drivekey_event_journal.append($1::uuid,$2::jsonb)',[this.sourceId,body]);
  if(rows.length!==1)throw Error('Ambiguous event append acknowledgement.');
  return {sequence:sequence.min(1).parse(Number(rows[0].sequence)),observedAt:time.parse(Number(rows[0].observed_at))};
 }
 async page(after:number,limit=100){
  sequence.parse(after);z.number().int().min(1).max(100).parse(limit);
  const rows=await this.query('select drivekey_event_journal.read_page($1::uuid,$2::bigint,$3::integer) as page',[this.sourceId,after,limit]);
  if(rows.length!==1)throw Error('Invalid journal page acknowledgement.');
  const page=pageSchema.parse(rows[0].page);
  if(page.sourceId!==this.sourceId||page.head<after||page.records.length!==Math.min(limit,page.head-after))throw Error('Event journal gap or source mismatch.');
  const records=page.records.map((r,i)=>{
   if(r.sequence!==after+i+1||r.observedAt>page.observedAt||(i>0&&r.observedAt<page.records[i-1].observedAt))throw Error('Invalid journal sequence or time.');
   return {...r,event:validateOperationalEvent(r.event)};
  });
  return {...page,records};
 }
}
