import type {PostgresServiceEventJournal} from './service-event-journal';
import type {DurableOperationalAlerts} from './durable-service-alerts';

// One bounded page, no initialization, recovery, notification or automatic retry.
// The caller supplies authenticated stores for a separately reviewed source/scope.
export async function collectServiceEventPage(
 journal:Pick<PostgresServiceEventJournal,'sourceId'|'page'>,
 monitor:Pick<DurableOperationalAlerts,'sourcePosition'|'ingest'>,
 now:()=>number=Date.now,
){
 let phase:'position'|'read'|'commit'='position';
 try{
  const position=await monitor.sourcePosition();
  if(position.id!==journal.sourceId)throw Error('Source mismatch');
  phase='read';const page=await journal.page(position.sequence,100);
  if(page.sourceId!==position.id||page.head<position.sequence)throw Error('Source mismatch');
  const checkedAt=now();
  if(!Number.isSafeInteger(checkedAt)||checkedAt<0||page.readAt<page.observedAt||Math.abs(page.readAt-checkedAt)>5000){
   return {state:'clock-skew' as const,phase:'read' as const,coverage:'unverified' as const};
  }
  if(!page.records.length){
   if(page.head!==position.sequence)throw Error('Journal gap');
   return {state:'observed-head-reached' as const,sequence:position.sequence,observedHead:page.head,processed:0,captureEnabled:page.captureEnabled,coverage:'observed-head-only' as const};
  }
  // Use the authenticated source clock for event validation only after bounding
  // cross-host skew. A rollback below its timestamp high-water mark stops reads.
  phase='commit';const result=await monitor.ingest({sourceId:position.id,records:page.records},Math.max(checkedAt,page.readAt));
  return {state:result.state==='conflict'?'conflict' as const:result.sequence>=page.head?'observed-head-reached' as const:'more-pages' as const,
   sequence:result.sequence,observedHead:page.head,processed:result.committed?page.records.length:0,captureEnabled:page.captureEnabled,coverage:'observed-head-only' as const};
 }catch{
  // A commit may have succeeded even when its acknowledgement was lost. The
  // next invocation rereads durable state; never infer rollback from an error.
  return {state:phase==='commit'?'commit-uncertain' as const:'unavailable' as const,phase,coverage:'unverified' as const};
 }
}
