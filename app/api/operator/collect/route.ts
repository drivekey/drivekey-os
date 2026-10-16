import {createHash,timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {PostgresServiceEventJournal} from '@/core/service-event-journal';
import {PostgresAlertCheckpointStore} from '@/core/service-alert-store';
import {DurableOperationalAlerts} from '@/core/durable-service-alerts';
import {collectServiceEventPage} from '@/core/service-event-collector';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'}});
// Deliberately no telemetry wrapper: collecting logs must not append another log
// to the same journal or create an unbounded self-triggering monitoring stream.
export async function GET(req:NextRequest){
 const expected=process.env.SERVICE_EVENT_COLLECTOR_TOKEN_SHA256;
 if(process.env.SERVICE_EVENT_COLLECTOR_ENABLED!=='true'||!expected||!/^[0-9a-f]{64}$/.test(expected))return reply({error:'Collector unavailable.'},503);
 const authorization=req.headers.get('authorization');
 if(!authorization||!/^Bearer [-_a-zA-Z0-9]{43}$/.test(authorization)||!timingSafeEqual(createHash('sha256').update(authorization.slice(7)).digest(),Buffer.from(expected,'hex')))return reply({error:'Collector authentication required.'},401);
 // No browser session, query command, event payload, URL or source override.
 if(req.headers.has('origin')||req.nextUrl.search||req.headers.has('transfer-encoding')||(req.headers.get('content-length')??'0')!=='0')return reply({error:'Unsupported collector request.'},400);
 const url=process.env.SERVICE_EVENT_JOURNAL_READER_URL,source=process.env.SERVICE_EVENT_JOURNAL_SOURCE_ID,storeUrl=process.env.SERVICE_EVENT_COLLECTOR_DATABASE_URL,scope=process.env.SERVICE_EVENT_COLLECTOR_SCOPE;
 if(!url||!source||!storeUrl||!scope||scope===process.env.SERVICE_ALERT_SCOPE)return reply({error:'Collector unavailable.'},503);
 const limited=await serviceRateLimitHttp('operator-collector',reply);if(limited)return limited;
 try{
  const result=await collectServiceEventPage(new PostgresServiceEventJournal(url,source),new DurableOperationalAlerts(new PostgresAlertCheckpointStore(storeUrl,scope)));
  const status=result.state==='conflict'?409:['unavailable','commit-uncertain','clock-skew'].includes(result.state)?503:200;
  return reply(result,status);
 }catch{return reply({error:'Collector state unavailable; reread durable progress before retrying.'},503);}
}
// Prevent Next's implicit HEAD handling from invoking the mutating GET handler.
export function HEAD(){return new Response(null,{status:405,headers:{Allow:'GET','Cache-Control':'no-store'}});}
