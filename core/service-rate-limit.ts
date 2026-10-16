import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';

// Aggregate service budgets; never keyed by an IP, wallet or user-supplied identity.
export const SERVICE_ROUTE_BUDGETS={offline:900,assets:400,trade:300,'nonce-offline':300,'lifi-execute':200,'lifi-quote':100,'husher-quote':300,'wallet-dashboard':120,'husher-owner':200,'operator-alerts':120,'operator-collector':4,rpc:900} as const;
export type ServiceRoute=keyof typeof SERVICE_ROUTE_BUDGETS;
export interface ServiceRateLimitDecision{allowed:boolean;retryAfter:number;}
export interface ServiceRateLimitStore{take(route:ServiceRoute):Promise<ServiceRateLimitDecision>;}
const unavailable='Shared service rate limit unavailable. Request stopped; retry later.';
export class ServiceRateLimitLedger implements ServiceRateLimitStore{
 private readonly sql:NeonQueryFunction<false,false>;
 private readonly scope:string;
 constructor(url:string,scope:string){
  try{const parsed=new URL(url);if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname.endsWith('.neon.tech')||!/^[a-zA-Z0-9_-]{1,80}$/.test(scope))throw Error();this.sql=neon(url);this.scope=scope;}catch{throw Error('Unsupported private service rate limit configuration.');}
 }
 async take(route:ServiceRoute):Promise<ServiceRateLimitDecision>{
  if(!Object.prototype.hasOwnProperty.call(SERVICE_ROUTE_BUDGETS,route))throw Error('Unsupported service rate limit route.');
  try{
   const rows=await this.sql.query('select allowed,retry_after from drivekey_service_limits.take($1,$2)',[this.scope,route],{fetchOptions:{signal:AbortSignal.timeout(5000)}});
   if(rows.length!==1)throw Error();const r=rows[0];
   if(typeof r.allowed!=='boolean'||!Number.isInteger(r.retry_after)||r.retry_after<0||r.retry_after>60||(r.allowed?r.retry_after!==0:r.retry_after<1))throw Error();
   return {allowed:r.allowed,retryAfter:r.retry_after};
  }catch{throw Error(unavailable);}
 }
}

