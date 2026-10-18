import {tagServiceResponse,type OperationalReason} from './service-events';
import {ServiceRateLimitLedger,type ServiceRoute} from './service-rate-limit';
type Store={take(route:ServiceRoute):Promise<{allowed:boolean;retryAfter:number}>};
type Env={VERCEL?:string;NODE_ENV?:string;SERVICE_RATE_LIMIT_DATABASE_URL?:string;SERVICE_RATE_LIMIT_SCOPE?:string};
// Aggregate cross-worker backstop, not a trustworthy per-client/IP quota.
export async function serviceRateLimitHttp(route:ServiceRoute,reply:(body:unknown,status:number,reason?:OperationalReason)=>Response,options:{env?:Env;createStore?:(url:string,scope:string)=>Store}={}){
 const env=options.env??process.env,url=env.SERVICE_RATE_LIMIT_DATABASE_URL,scope=env.SERVICE_RATE_LIMIT_SCOPE;
 const required=env.VERCEL==='1'||env.NODE_ENV==='production'||url!==undefined||scope!==undefined;
 if(!required)return null; // Existing local counters only; no distributed guarantee.
 try{
  if(!url||!scope)throw Error();
  const store=(options.createStore??((u,s)=>new ServiceRateLimitLedger(u,s)))(url,scope),decision=await store.take(route);
  if(typeof decision.allowed!=='boolean'||!Number.isSafeInteger(decision.retryAfter)||decision.allowed&&decision.retryAfter!==0||!decision.allowed&&(decision.retryAfter<1||decision.retryAfter>60))throw Error();
  if(decision.allowed)return null;
  const response=reply({error:'Service request limit reached. Try again shortly.',code:'SERVICE_RATE_LIMITED',canResubmit:false,canRetryCreate:false},429);response.headers.set('Retry-After',String(decision.retryAfter));return response;
 }catch{return tagServiceResponse(reply({error:'Shared service request limit is unavailable. Reconcile saved operations; do not repeat creation or submission.',code:'SERVICE_RATE_LIMIT_UNAVAILABLE',canResubmit:false,canRetryCreate:false},503,'storage-unavailable'),'storage-unavailable');}
}
