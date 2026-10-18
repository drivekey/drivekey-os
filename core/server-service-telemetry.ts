import 'server-only';
import {after} from 'next/server';
import {recordServiceEvent as record,withServiceTelemetry as wrap,type ServiceName,type OperationalReason} from './service-events';
import {DurableOperationalAlerts} from './durable-service-alerts';
import {PostgresAlertCheckpointStore} from './service-alert-store';
import {PostgresServiceEventJournal} from './service-event-journal';
export {tagServiceResponse,operationalReason,type OperationalReason} from './service-events';
type Failure='configuration'|'scheduling'|'storage-or-state'|'contention'|'capacity'|'journal-unavailable'|'journal-capacity';
function degraded(reason:Failure){try{console.warn(JSON.stringify({version:1,monitor:'operational-alerts',state:'degraded',reason}));}catch{/* Never change an action response. */}}
// Called only with the server's redacted event serialization. No request, header,
// provider response, exception or wallet object enters this background callback.
function serverSink(line:string){
 try{console.info(line);}catch{/* Independent persistence may still work. */}
 const url=process.env.SERVICE_ALERT_DATABASE_URL,scope=process.env.SERVICE_ALERT_SCOPE;
 const journalUrl=process.env.SERVICE_EVENT_JOURNAL_WRITER_URL,sourceId=process.env.SERVICE_EVENT_JOURNAL_SOURCE_ID;
 if((!!url!==!!scope)||(!!journalUrl!==!!sourceId))degraded('configuration');
 if(!(url&&scope)&&!(journalUrl&&sourceId))return; // Unconfigured is never healthy.
 try{
  after(async()=>{
   try{
    if(line.length>2048)throw Error();
    const event:unknown=JSON.parse(line);
    const work:Array<Promise<void>>=[];
    if(journalUrl&&sourceId)work.push((async()=>{
     try{
      // One append attempt. Its stable event ID supports subsequent reconciliation;
      // an ambiguous result never retries the original API or resets the source.
      const accepted=await new PostgresServiceEventJournal(journalUrl,sourceId).append(event);
      if(accepted.sequence>=9000)degraded('journal-capacity');
     }catch{degraded('journal-unavailable');}
    })());
    if(url&&scope)work.push((async()=>{try{
    const monitor=new DurableOperationalAlerts(new PostgresAlertCheckpointStore(url,scope));
    // Retry only an explicitly rejected CAS, never an uncertain DB error and
    // never the transaction/API action that produced this operational event.
    for(let attempt=0;attempt<3;attempt++){
     const result=await monitor.observe(event,Date.now());
     if(result.committed){if('monitoringDegraded' in result&&result.monitoringDegraded)degraded('capacity');return;}
    }
    degraded('contention');
    }catch{degraded('storage-or-state');}})());
    await Promise.all(work);
   }catch{degraded('storage-or-state');}
  });
 }catch{degraded('scheduling');}
}
export function recordServiceEvent(requestId:string,status:number,elapsedMs:number,sink:((line:string)=>void)|undefined=undefined,service:ServiceName='lifi-execute',reason?:OperationalReason){
 record(requestId,status,elapsedMs,sink??serverSink,service,reason);
}
export function withServiceTelemetry<T>(service:ServiceName,handler:(request:T)=>Promise<Response>,sink?:(line:string)=>void){return wrap(service,handler,sink??serverSink);}
