import {z} from 'zod';
import {OperationalAlertClassifier,type OperationalIncident} from './service-alerts';
import {SERVICE_NAMES,OPERATIONAL_REASONS} from './service-events';
const incident=z.object({id:z.string().uuid(),service:z.enum(SERVICE_NAMES),reason:z.enum(OPERATIONAL_REASONS),transition:z.enum(['opened','recovered']),action:z.enum(['inspect-authentication','review-program-upgrade','restore-storage','reconcile-without-resending','inspect-rate-capacity'])}).strict();
const fields={checkpoint:z.unknown(),pending:z.array(incident).max(100)};
const source=z.object({id:z.string().uuid(),sequence:z.number().int().nonnegative().safe()}).strict();
const document=z.discriminatedUnion('version',[
 z.object({version:z.literal(1),...fields}).strict(),
 z.object({version:z.literal(2),...fields,source}).strict(),
]);
export type AlertDocument=z.infer<typeof document>;
export interface AlertCheckpointStore{
 read():Promise<{revision:number;document:unknown}|null>;
 // Must atomically compare expected revision and persist the next document.
 compareAndSwap(expectedRevision:number,next:AlertDocument):Promise<boolean>;
}
const actionByReason:Record<OperationalIncident['reason'],OperationalIncident['action']>={'auth-failed':'inspect-authentication','identity-pin-mismatch':'review-program-upgrade','storage-unavailable':'restore-storage','reconciliation-stale':'reconcile-without-resending','rate-limited':'inspect-rate-capacity'};
export function validateAlertDocument(input:unknown){
 const d=document.parse(input);OperationalAlertClassifier.restore(d.checkpoint);
 if(new Set(d.pending.map(i=>i.id)).size!==d.pending.length||d.pending.some(i=>i.action!==actionByReason[i.reason]))throw Error('Invalid pending incident state.');
 return d;
}
export class DurableOperationalAlerts{
 constructor(private readonly store:AlertCheckpointStore){}
 // Explicit installation only, never automatically called by an ingestion or
 // delivery worker. Reinitializing lost state requires an operator gap review.
 async initialize(){
  const saved=await this.store.read();
  if(saved!==null){await this.load();return false;}
  return this.store.compareAndSwap(0,{version:1,checkpoint:new OperationalAlertClassifier().checkpoint(),pending:[]});
 }
 private async load(){
  const saved=await this.store.read();
  if(saved===null)throw Error('Alert checkpoint missing; monitoring degraded.');
  if(!Number.isSafeInteger(saved.revision)||saved.revision<1||saved.revision>=Number.MAX_SAFE_INTEGER)throw Error('Invalid alert revision.');
  return {...saved,document:validateAlertDocument(saved.document)};
 }
 async observe(event:unknown,now:number){
  const saved=await this.load(),classifier=OperationalAlertClassifier.restore(saved.document.checkpoint);
  if(saved.document.version===2)throw Error('Source-bound monitoring requires ordered ingestion.');
  const result=classifier.observe(event,now);
  const pending=[...saved.document.pending,...result.incidents.map(i=>({...i,id:crypto.randomUUID()}))];
  if(pending.length>100)throw Error('Pending alert capacity reached; monitoring degraded.');
  const next=validateAlertDocument({...saved.document,checkpoint:classifier.checkpoint(),pending});
  if(!await this.store.compareAndSwap(saved.revision,next))return {state:'conflict' as const,committed:false};
  return {state:result.state,committed:true,...(result.monitoringDegraded?{monitoringDegraded:true as const}:{})};
 }
 // Trusted operator path only. A boolean in an untrusted request is not evidence.
 async recover(evidence:unknown,now:number){
  const saved=await this.load(),classifier=OperationalAlertClassifier.restore(saved.document.checkpoint);
  if(saved.document.version===2)throw Error('Source-bound recovery requires an ordered recovery protocol.');
  const incidents=classifier.recover(evidence,now);
  const pending=[...saved.document.pending,...incidents.map(i=>({...i,id:crypto.randomUUID()}))];
  if(pending.length>100)throw Error('Pending alert capacity reached; monitoring degraded.');
  const next=validateAlertDocument({...saved.document,checkpoint:classifier.checkpoint(),pending});
  return {committed:await this.store.compareAndSwap(saved.revision,next)};
 }
 // Explicit new-scope installation only. The trusted adapter owns this stream
 // identity and must supply a complete, ordered, durable source from sequence 1.
 // Never migrate an existing checkpoint or silently skip a source retention gap.
 async initializeSource(id:string){
  source.parse({id,sequence:0});
  const saved=await this.store.read();
  if(saved!==null){const loaded=await this.load();if(loaded.document.version!==2||loaded.document.source.id!==id)throw Error('Monitoring source already configured differently.');return false;}
  return this.store.compareAndSwap(0,{version:2,source:{id,sequence:0},checkpoint:new OperationalAlertClassifier().checkpoint(),pending:[]});
 }
 async sourcePosition(){
  const saved=await this.load();if(saved.document.version!==2)throw Error('Ordered monitoring source not configured.');
  return {...saved.document.source};
 }
 async ingest(input:unknown,now:number){
  const batch=z.object({sourceId:z.string().uuid(),records:z.array(z.object({sequence:z.number().int().positive().safe(),observedAt:z.number().int().nonnegative().safe(),event:z.unknown()}).strict()).min(1).max(100)}).strict().parse(input);
  if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid ingestion time.');
  const saved=await this.load(),d=saved.document;
  if(d.version!==2||d.source.id!==batch.sourceId)throw Error('Monitoring source mismatch.');
  for(let i=0;i<batch.records.length;i++){
   const r=batch.records[i],previous=batch.records[i-1];
   if(r.observedAt>now||(previous&&(r.sequence!==previous.sequence+1||r.observedAt<previous.observedAt)))throw Error('Invalid source order or observation time.');
  }
  const first=batch.records[0].sequence,last=batch.records[batch.records.length-1].sequence;
  if(last<=d.source.sequence)return {state:'already-committed' as const,committed:false,sequence:d.source.sequence};
  if(first!==d.source.sequence+1)throw Error('Monitoring source gap or overlap; reread cursor.');
  const classifier=OperationalAlertClassifier.restore(d.checkpoint),pending=[...d.pending];
  for(const record of batch.records){
   const result=classifier.observeOrdered(record.event,record.observedAt);
   if(result.monitoringDegraded)throw Error('Classifier capacity reached; source cursor retained.');
   pending.push(...result.incidents.map(i=>({...i,id:crypto.randomUUID()})));
   if(pending.length>100)throw Error('Pending alert capacity reached; source cursor retained.');
  }
  const next=validateAlertDocument({version:2,source:{id:d.source.id,sequence:last},checkpoint:classifier.checkpoint(),pending});
  const committed=await this.store.compareAndSwap(saved.revision,next);
  return {state:committed?'accepted' as const:'conflict' as const,committed,sequence:committed?last:d.source.sequence};
 }
 async pending(){const saved=await this.load();return {revision:saved.revision,incidents:saved.document.pending};}
 // Call only after the configured destination acknowledges delivery. This does
 // not mark an incident recovered. Lost delivery acknowledgements can duplicate
 // notifications; destinations must deduplicate by the stable incident ID.
 async acknowledge(revision:number,id:string){
  z.string().uuid().parse(id);const saved=await this.load();
  if(saved.revision!==revision)return false;
  if(!saved.document.pending.some(i=>i.id===id))return true;
  return this.store.compareAndSwap(revision,{...saved.document,pending:saved.document.pending.filter(i=>i.id!==id)});
 }
}
