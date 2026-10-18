import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {approvedAppOrigin} from '@/core/app-origin';
import {husherOwnerCookie,requireHusherOwner,validOwnerOrigin} from '@/core/husher-owner';
import {husherServer} from '@/core/husher-server';
import {PostgresAlertCheckpointStore} from '@/core/service-alert-store';
import {DurableOperationalAlerts,validateAlertDocument,type AlertCheckpointStore} from '@/core/durable-service-alerts';
import {operatorAlertView,operatorCollectionStatus} from '@/core/operator-alert-view';
import {PostgresServiceEventJournal} from '@/core/service-event-journal';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('read'),stream:z.enum(['direct','collected']).default('direct')}).strict(),
 z.object({action:z.literal('acknowledge'),stream:z.enum(['direct','collected']).default('direct'),id:z.string().uuid(),revision:z.number().int().positive().safe()}).strict(),
]);
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function POST(req:NextRequest){
 const host=req.headers.get('host'),expected=host&&approvedAppOrigin('https://'+host)?'https://'+host:process.env.VERCEL_URL&&host===process.env.VERCEL_URL?'https://'+host:!process.env.VERCEL&&host&&/^127\.0\.0\.1:\d+$/.test(host)?'http://'+host:'';
 if(!validOwnerOrigin(req.headers.get('origin'),expected))return reply({error:'Same-origin owner access required.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'JSON required.'},415);
 const token=req.cookies.get(husherOwnerCookie)?.value;
 if(!token||!/^[-_a-zA-Z0-9]{43}$/.test(token))return reply({error:'Sign in with your DriveKey owner code.'},401);
 try{
  try{await requireHusherOwner(token,husherServer().store);}catch{return reply({error:'Owner session unavailable. Sign in again or check service status.'},401);}
  // Only validated sessions consume this separate budget. Public login traffic
  // must not prevent an already authenticated operator from inspecting alerts.
  const limit=await serviceRateLimitHttp('operator-alerts',reply);if(limit)return limit;
  const reader=req.body?.getReader();if(!reader)return reply({error:'Invalid request.'},400);
  let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  // Small command body only; the request never accepts events or destinations.
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},3000);
  let command:z.infer<typeof action>;
  try{for(;;){const part=await reader.read();if(timedOut)throw Error('Request timeout');if(part.done)break;size+=part.value.length;if(size>512){void reader.cancel().catch(()=>{});return reply({error:'Request too large.'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();command=action.parse(JSON.parse(text));}
  catch{return reply({error:'Invalid request.'},400);}finally{clearTimeout(timer);}
  // Body delivery and quota storage can outlive the initial authorization.
  // Recheck before reading monitoring data or acknowledging a notification.
  try{await requireHusherOwner(token,husherServer().store);}catch{return reply({error:'Owner session unavailable. Sign in again or check service status.'},401);}
  const collected=command.stream==='collected';
  const url=collected?process.env.SERVICE_EVENT_COLLECTOR_DATABASE_URL:process.env.SERVICE_ALERT_DATABASE_URL,scope=collected?process.env.SERVICE_EVENT_COLLECTOR_SCOPE:process.env.SERVICE_ALERT_SCOPE;
  if(!url||!scope)return reply({error:'Monitoring is not configured.'},503);
  if(collected&&(!process.env.SERVICE_EVENT_JOURNAL_SOURCE_ID||scope===process.env.SERVICE_ALERT_SCOPE))return reply({error:'Collected monitoring is not configured separately.'},503);
  const backing=new PostgresAlertCheckpointStore(url,scope),sourceId=process.env.SERVICE_EVENT_JOURNAL_SOURCE_ID;
  const validateSource=(input:unknown)=>{
   const document=validateAlertDocument(input);
   if(document.version!==2||document.source.id!==sourceId)throw Error('Collected source mismatch');
  };
  // Validate the exact state used by acknowledgement and by the final view,
  // rather than a separate earlier read that can become stale.
  const store:AlertCheckpointStore=collected?{
   async read(){const saved=await backing.read();if(!saved)throw Error('Missing collected checkpoint');validateSource(saved.document);return saved;},
   async compareAndSwap(revision,next){validateSource(next);return backing.compareAndSwap(revision,next);},
  }:backing;
  if(command.action==='acknowledge'){
   const accepted=await new DurableOperationalAlerts(store).acknowledge(command.revision,command.id);
   if(!accepted)return reply({error:'Alerts changed. Refresh before marking this notification read.'},409);
  }
  const saved=await store.read(),view=operatorAlertView(saved);
  if(!collected)return reply(view);
  let collection:Awaited<ReturnType<typeof operatorCollectionStatus>>={state:'unavailable',coverage:'unverified'};
  const readerUrl=process.env.SERVICE_EVENT_JOURNAL_READER_URL;
  // Source-read failures do not erase already verified incident evidence.
  try{if(readerUrl&&saved&&sourceId)collection=await operatorCollectionStatus(saved,new PostgresServiceEventJournal(readerUrl,sourceId));}catch{}
  return reply({...view,collection});
 }catch{return reply({error:'Monitoring state unavailable. Do not assume there are no incidents.'},503);}
}
