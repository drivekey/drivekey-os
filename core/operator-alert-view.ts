import {validateAlertDocument} from './durable-service-alerts';
import {OperationalAlertClassifier} from './service-alerts';
import type {PostgresServiceEventJournal} from './service-event-journal';

export function operatorAlertView(saved:{revision:number;document:unknown}|null){
 if(!saved||!Number.isSafeInteger(saved.revision)||saved.revision<1||saved.revision>=Number.MAX_SAFE_INTEGER)throw Error('Monitoring state unavailable');
 const document=validateAlertDocument(saved.document),checkpoint=OperationalAlertClassifier.restore(document.checkpoint).checkpoint();
 return {version:1 as const,revision:saved.revision,coverage:'unverified' as const,
  lastObservedAt:checkpoint.lastTime<0?null:checkpoint.lastTime,
  openIncidents:checkpoint.states.filter(s=>s.open).map(s=>({service:s.service,reason:s.reason})),
  notifications:document.pending.map(i=>({id:i.id,service:i.service,reason:i.reason,transition:i.transition,action:i.action}))};
}
export async function operatorCollectionStatus(saved:{revision:number;document:unknown},journal:Pick<PostgresServiceEventJournal,'sourceId'|'page'>,now:()=>number=Date.now){
 try{
  const document=validateAlertDocument(saved.document);
  if(document.version!==2||document.source.id!==journal.sourceId)throw Error('Source mismatch');
  const page=await journal.page(document.source.sequence,1),checkedAt=now();
  if(page.sourceId!==document.source.id||page.head<document.source.sequence||!Number.isSafeInteger(checkedAt)||checkedAt<0||page.readAt<page.observedAt||Math.abs(checkedAt-page.readAt)>5000)throw Error('Unverified source');
  return {state:'observed' as const,coverage:'observed-head-only' as const,checkedAt:page.readAt,captureEnabled:page.captureEnabled,processed:document.source.sequence,recorded:page.head,waiting:page.head-document.source.sequence,capacity:10000,capacityStatus:page.head>=10000?'full' as const:page.head>=9000?'near-limit' as const:'available' as const};
 }catch{return {state:'unavailable' as const,coverage:'unverified' as const};}
}
export type OperatorAlertView=ReturnType<typeof operatorAlertView>&{collection?:Awaited<ReturnType<typeof operatorCollectionStatus>>};
