import {z} from 'zod';
import {SERVICE_NAMES,OPERATIONAL_REASONS,serviceEvent,type OperationalReason,type ServiceName} from './service-events';
const eventSchema=z.object({version:z.literal(1),service:z.enum(SERVICE_NAMES),requestId:z.string().uuid(),status:z.number().int().min(100).max(599),outcome:z.enum(['ok','rejected','limited','unavailable','failed']),durationBucket:z.enum(['under-1s','1-5s','5-15s','15-60s','over-60s']),reason:z.enum(OPERATIONAL_REASONS).optional()}).strict();
export function validateOperationalEvent(input:unknown){
 const e=eventSchema.parse(input),expected=serviceEvent(e.requestId,e.status,0,e.service,e.reason);
 if(expected.outcome!==e.outcome)throw Error('Inconsistent event outcome.');
 return e;
}
const thresholds:Record<OperationalReason,number>={'auth-failed':5,'identity-pin-mismatch':1,'storage-unavailable':3,'reconciliation-stale':1,'rate-limited':5};
export type OperationalIncident={service:ServiceName;reason:OperationalReason;transition:'opened'|'recovered';action:'inspect-authentication'|'review-program-upgrade'|'restore-storage'|'reconcile-without-resending'|'inspect-rate-capacity';};
const actions:Record<OperationalReason,OperationalIncident['action']>={'auth-failed':'inspect-authentication','identity-pin-mismatch':'review-program-upgrade','storage-unavailable':'restore-storage','reconciliation-stale':'reconcile-without-resending','rate-limited':'inspect-rate-capacity'};
const checkpointSchema=z.object({version:z.literal(1),lastTime:z.number().int().min(-1).safe(),
 seen:z.array(z.object({service:z.enum(SERVICE_NAMES),reason:z.enum(OPERATIONAL_REASONS),ids:z.array(z.object({id:z.string().uuid(),until:z.number().int().nonnegative().safe()}).strict()).min(1).max(64)}).strict()).max(50),
 states:z.array(z.object({service:z.enum(SERVICE_NAMES),reason:z.enum(OPERATIONAL_REASONS),times:z.array(z.number().int().nonnegative().safe()).min(1).max(5),open:z.boolean()}).strict()).max(50),
}).strict();
// Local reference classifier, not a hosted monitor. At most 50 aggregate states
// and 64 IDs per service/reason (3,200 total). Noisy classes cannot starve others. No transaction/user identity is retained.
export class OperationalAlertClassifier{
 private seen=new Map<string,Map<string,number>>();private states=new Map<string,{times:number[];open:boolean}>();private lastTime=-1;
 private time(now:number){if(!Number.isSafeInteger(now)||now<0||now<this.lastTime)throw Error('Invalid observation time.');this.lastTime=now;}
 // Checkpoint provenance belongs to the restricted store. Validation does not
 // authenticate arbitrary files and never makes this state spending authority.
 static restore(input:unknown){
  const p=checkpointSchema.parse(input),c=new OperationalAlertClassifier();
  if(p.lastTime===-1&&(p.seen.length||p.states.length))throw Error('Invalid empty checkpoint.');
  c.lastTime=p.lastTime;
  for(const b of p.seen){const key=b.service+':'+b.reason;
   if(c.seen.has(key)||new Set(b.ids.map(x=>x.id)).size!==b.ids.length||b.ids.some(x=>x.until>p.lastTime+300000))throw Error('Invalid deduplication checkpoint.');
   c.seen.set(key,new Map(b.ids.map(x=>[x.id,x.until])));
  }
  for(const s of p.states){const key=s.service+':'+s.reason;
   if(c.states.has(key)||s.times.length>thresholds[s.reason]||s.times.some((t,i)=>t>p.lastTime||(i>0&&t<s.times[i-1]))||(!s.open&&s.times.length>=thresholds[s.reason]))throw Error('Invalid incident checkpoint.');
   c.states.set(key,{times:[...s.times],open:s.open});
  }
  return c;
 }
 checkpoint(){
  const identity=(key:string)=>{const [service,reason]=key.split(':');return {service:service as ServiceName,reason:reason as OperationalReason};};
  return {version:1 as const,lastTime:this.lastTime,seen:[...this.seen].map(([key,ids])=>({...identity(key),ids:[...ids].map(([id,until])=>({id,until}))})),states:[...this.states].map(([key,state])=>({...identity(key),times:[...state.times],open:state.open}))};
 }
 observe(input:unknown,now:number){return this.observeEvent(input,now,false);}
 // Only for an atomically checkpointed ordered source. Recovery must not run
 // out of band. Once open, further events cannot create another transition;
 // retaining their IDs would only exhaust replay storage and stall the stream.
 observeOrdered(input:unknown,now:number){return this.observeEvent(input,now,true);}
 private observeEvent(input:unknown,now:number,ordered:boolean):{state:'accepted'|'duplicate'|'capacity';incidents:OperationalIncident[];monitoringDegraded?:true}{
  const e=validateOperationalEvent(input);this.time(now);
  const reason=e.reason??(e.outcome==='limited'?'rate-limited':undefined);
  if(!reason)return {state:'accepted',incidents:[]};
  if(ordered&&this.states.get(e.service+':'+reason)?.open)return {state:'accepted',incidents:[]};
  const bucketKey=e.service+':'+reason,bucket=this.seen.get(bucketKey)??new Map<string,number>();
  for(const[id,until]of bucket)if(until<=now)bucket.delete(id);
  if(bucket.has(e.requestId))return {state:'duplicate',incidents:[]};
  if(bucket.size>=64)return {state:'capacity',monitoringDegraded:true,incidents:[]};
  bucket.set(e.requestId,now+300000);this.seen.set(bucketKey,bucket);
  const key=e.service+':'+reason,state=this.states.get(key)??{times:[],open:false};
  state.times=state.times.filter(t=>t>now-60000);state.times.push(now);state.times=state.times.slice(-thresholds[reason]);this.states.set(key,state);
  if(state.open||state.times.length<thresholds[reason])return {state:'accepted',incidents:[]};
  state.open=true;return {state:'accepted',incidents:[{service:e.service,reason,transition:'opened',action:actions[reason]}]};
 }
 // Recovery requires explicit trusted evidence; ordinary HTTP success never calls this.
 recover(input:unknown,now:number):OperationalIncident[]{
  const e=z.object({service:z.enum(SERVICE_NAMES),reason:z.enum(OPERATIONAL_REASONS),independentlyChecked:z.literal(true)}).strict().parse(input);this.time(now);
  const key=e.service+':'+e.reason,state=this.states.get(key);if(!state?.open)return [];this.states.delete(key);
  return [{service:e.service,reason:e.reason,transition:'recovered',action:actions[e.reason]}];
 }
 sizes(){return {deduplicationIds:[...this.seen.values()].reduce((n,b)=>n+b.size,0),aggregateStates:this.states.size};}
}
// Only an explicit saved-operation age and fresh unresolved check can produce
// stale evidence. The caller must derive these from its durable reconciliation record.
export function staleReconciliationEvent(input:unknown){
 const r=z.object({service:z.enum(SERVICE_NAMES),requestId:z.string().uuid(),firstUnresolvedAt:z.number().int().nonnegative().safe(),checkedAt:z.number().int().nonnegative().safe(),now:z.number().int().nonnegative().safe(),state:z.literal('unresolved')}).strict().parse(input);
 if(r.firstUnresolvedAt>r.checkedAt||r.checkedAt>r.now||r.now-r.checkedAt>30000)throw Error('Untrusted reconciliation observation timing.');
 if(r.checkedAt-r.firstUnresolvedAt<900000)return null;
 return serviceEvent(r.requestId,200,0,r.service,'reconciliation-stale');
}
