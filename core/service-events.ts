// Operational metadata only. Never accept request bodies, exceptions, URLs,
// headers, addresses, transaction hashes or credentials as event fields.
export const SERVICE_NAMES=['lifi-execute','husher-owner','offline','assets','trade','nonce-offline','wallet-dashboard','lifi-quote','husher-quote','rpc'] as const;
export type ServiceName=typeof SERVICE_NAMES[number];
export const OPERATIONAL_REASONS=['auth-failed','identity-pin-mismatch','storage-unavailable','reconciliation-stale','rate-limited'] as const;
export type OperationalReason=typeof OPERATIONAL_REASONS[number];
export class OperationalError extends Error{constructor(message:string,readonly reason:OperationalReason){super(message);}}
export const operationalReason=(error:unknown):OperationalReason|undefined=>error instanceof OperationalError&&OPERATIONAL_REASONS.includes(error.reason)?error.reason:undefined;
const responseReasons=new WeakMap<Response,OperationalReason>();
export function tagServiceResponse<T extends Response>(response:T,reason:OperationalReason|undefined):T{if(reason&&OPERATIONAL_REASONS.includes(reason))responseReasons.set(response,reason);return response;}
export type ServiceEvent={
 reason?:OperationalReason;
 version:1;service:ServiceName;requestId:string;
 outcome:'ok'|'rejected'|'limited'|'unavailable'|'failed';status:number;
 durationBucket:'under-1s'|'1-5s'|'5-15s'|'15-60s'|'over-60s';
};
export function serviceEvent(requestId:string,status:number,elapsedMs:number,service:ServiceName='lifi-execute',reason?:OperationalReason):ServiceEvent{
 if(!SERVICE_NAMES.includes(service))throw Error('Invalid service identity.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)||!Number.isInteger(status)||status<100||status>599||!Number.isFinite(elapsedMs)||elapsedMs<0)throw Error('Invalid operational metadata.');
 if(reason!==undefined&&!OPERATIONAL_REASONS.includes(reason))throw Error('Invalid operational reason.');
 return {version:1,service,requestId,status,...(reason?{reason}:{}),
  outcome:status<400?'ok':status===429?'limited':status===503?'unavailable':status<500?'rejected':'failed',
  durationBucket:elapsedMs<1000?'under-1s':elapsedMs<5000?'1-5s':elapsedMs<15000?'5-15s':elapsedMs<60000?'15-60s':'over-60s'};
}
export function recordServiceEvent(requestId:string,status:number,elapsedMs:number,sink:(line:string)=>void=line=>console.info(line),service:ServiceName='lifi-execute',reason?:OperationalReason){
 // Logging must never cause an automatic client retry after a successful send.
 try{sink(JSON.stringify(serviceEvent(requestId,status,elapsedMs,service,reason)));}catch{/* Monitoring transport is not transaction state. */}
}

// The ID originates on the server; request headers and bodies are never inspected.
// Preserve handler errors and response semantics. Monitoring does not authorize retries.
export function withServiceTelemetry<T>(service:ServiceName,handler:(request:T)=>Promise<Response>,sink?:(line:string)=>void){
 return async(request:T):Promise<Response>=>{
  const requestId=crypto.randomUUID(),started=performance.now();
  let status=500,reason:OperationalReason|undefined;
  try{
   const response=await handler(request);status=response.status;reason=responseReasons.get(response);
   // Owned API responses have mutable headers. An immutable response must still
   // be returned unchanged rather than turning telemetry into an action failure.
   try{response.headers.set('X-Request-ID',requestId);}catch{}
   return response;
  }catch(error){reason=operationalReason(error);throw error;}finally{recordServiceEvent(requestId,status,Math.max(0,performance.now()-started),sink,service,reason);}
 };
}
