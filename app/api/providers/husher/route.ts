import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {approvedAppOrigin} from '@/core/app-origin';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {HUSHER_STANDARD_ACCEPTED} from '@/core/husher-release';
import {husherServer} from '@/core/husher-server';
import {authenticateHusherOwner,requireHusherOwner,husherOwnerCookie,validOwnerOrigin,ownerTokenDigest} from '@/core/husher-owner';
import {createOwnedHusherOrder,prepareOwnedHusherOrder,preflightOwnedHusherOrder,submitOwnedHusherOrder,recoverOwnedHusherCreation,recoverOwnedHusherSubmission} from '@/core/husher-lifecycle';
import {inspectHusherSettlement} from '@/core/husher-settlement';
import {husherDepositStatus} from '@/core/husher-deposit-online';
import {inspectHusherAssetAccess} from '@/core/husher-api';
import {husherVolumeReservation} from '@/core/husher-valuation';
import {HUSHER_OFFLINE_WINDOW_ERROR,HUSHER_SUBMISSION_WINDOW_ERROR,HUSHER_MEASUREMENT_ERROR} from '@/core/husher-timing';
import {recordServiceEvent,operationalReason,type OperationalReason} from '@/core/server-service-telemetry';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const actions=z.object({action:z.enum(['login','logout','history','readiness','create','recover-create','recover-submission','prepare','preflight','submit','status']),input:z.unknown()}).strict();
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
// Exact authored messages only: never echo provider/database/URL exceptions.
const publicFailures=new Map<string,number>([
 [HUSHER_OFFLINE_WINDOW_ERROR,409],
 [HUSHER_SUBMISSION_WINDOW_ERROR,409],
 [HUSHER_MEASUREMENT_ERROR,409],
 ['Owner authentication failed.',400],
 ['Sign in as the Husher integration owner.',400],
 ['Husher ledger is not configured.',503],
 ['Private Ethereum RPC is not configured.',503],
 ['Creation outcome unresolved. Recover the correlation ID; do not recreate.',409],
 ['No matching durable owner intent.',409],
 ['No durable creation intent.',409],
 ['No durable submission to reconcile.',409],
 ['Approval does not match the durable creation intent.',409],
 ['Reconcile the allowance before using a previous-month order.',409],
 ['Current volume exceeds the reserved allowance.',409],
 ['Monthly allowance needs reconciliation.',409],
 ['Submission intent failed durable verification. Do not resend.',503],
 ['Durable Husher ledger operation failed. Reconcile saved intent; do not retry provider creation or submission.',503],
]);
export async function GET(){return reply({provider:'husher',standardEnabled:HUSHER_STANDARD_ACCEPTED,privateEnabled:false,ownerOnly:true,routes:HUSHER_STANDARD_ACCEPTED?['ethereum-eth-usdc-standard']:[],requiredIso:'RC19',settlementVerified:false});}
export async function POST(req:NextRequest){
 const requestId=crypto.randomUUID(),started=performance.now();
 const reply=(value:unknown,status=200,reason?:OperationalReason)=>{recordServiceEvent(requestId,status,Math.max(0,performance.now()-started),undefined,'husher-owner',reason);return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','X-Request-ID':requestId}});};
 // This API has cookie authority. Missing Origin is never accepted here.
 const host=req.headers.get('host'),expected=host&&approvedAppOrigin('https://'+host)?'https://'+host:process.env.VERCEL_URL&&host===process.env.VERCEL_URL?'https://'+host:!process.env.VERCEL&&host&&/^127\.0\.0\.1:\d+$/.test(host)?'http://'+host:'';
 if(!validOwnerOrigin(req.headers.get('origin'),expected))return reply({error:'Same-origin owner action required.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'JSON required.'},415);
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Missing input.');let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return reply({error:'Input too large.'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  let parsedBody:unknown;try{parsedBody=JSON.parse(text);}catch{return reply({error:'Malformed Husher action.',code:'HUSHER_INVALID_INPUT',canRetryCreate:false,canResubmit:false},400);}
  const a=actions.parse(parsedBody);
  if(!HUSHER_STANDARD_ACCEPTED&&['create','submit'].includes(a.action))return reply({error:'Husher standard execution has not passed release acceptance.',code:'HUSHER_DISABLED'},503);
 // Saved-order recovery and revocation remain behind owner authentication below,
 // but must not depend on a quota shared with unauthenticated login traffic.
 if(!['logout','history','status','recover-create','recover-submission'].includes(a.action)){const sharedLimit=await serviceRateLimitHttp('husher-owner',reply);if(sharedLimit)return sharedLimit;}
  const d=husherServer(a.action==='submit'),token=req.cookies.get(husherOwnerCookie)?.value;
  if(a.action==='login'){const input=z.object({code:z.string().max(100)}).strict().parse(a.input);const session=await authenticateHusherOwner(input.code,process.env.HUSHER_OWNER_TOKEN_SHA256,d.store);const response=reply({authenticated:true,expiresAt:session.expires.toISOString()});response.cookies.set(husherOwnerCookie,session.token,{httpOnly:true,secure:true,sameSite:'strict',path:'/',expires:session.expires});return response;}
  await requireHusherOwner(token,d.store);
  if(a.action==='logout'){await d.store.endSession(ownerTokenDigest(token!));const response=reply({authenticated:false});response.cookies.set(husherOwnerCookie,'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});return response;}
  if(a.action==='history')return reply({creations:await d.store.creations(),submissions:await d.store.history(),allowance:await d.store.allowance()});
  if(a.action==='readiness'){const [assets,valuation]=await Promise.all([inspectHusherAssetAccess(d.key),husherVolumeReservation('0.001',d.rpc)]);return reply({readOnly:true,assetsMatched:assets.metadataMatched,valuation,privateEnabled:false,providerCreateVerified:false});}
  if(a.action==='create')return reply(await createOwnedHusherOrder(a.input,d,HUSHER_STANDARD_ACCEPTED));
  if(a.action==='recover-create')return reply(await recoverOwnedHusherCreation(z.object({id:z.string().uuid()}).strict().parse(a.input).id,d));
  if(a.action==='recover-submission')return reply(await recoverOwnedHusherSubmission(a.input,husherServer(false,{readWalletJournal:true})));
  if(a.action==='prepare')return reply(await prepareOwnedHusherOrder(a.input,d));
  if(a.action==='preflight'){const result=await preflightOwnedHusherOrder(a.input,d);return reply({state:'ready',hash:result.s.transactionHash,submissionEnabled:HUSHER_STANDARD_ACCEPTED,privacyEnabled:false});}
  if(a.action==='submit')return reply(await submitOwnedHusherOrder(a.input,d,HUSHER_STANDARD_ACCEPTED));
  const input=z.object({fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/)}).strict().parse(a.input),saved=await d.store.submission(input.fingerprint);
  if(!saved)throw Error('No durable submission to reconcile.');
  const signed={request:saved.request,response:saved.response,wallet:saved.wallet};
  try{return reply(await inspectHusherSettlement(signed,{...d,claimPayout:(order,hash,index)=>d.store.claimPayout(order,hash,index)}));}
  catch{return reply({...await husherDepositStatus(signed,d.rpc),state:'exchange-unresolved',exchangeSettlementVerified:false,canResubmit:false,notice:'Deposit evidence checked; provider payout/refund evidence could not be verified. Do not resend.'});}
 }catch(e){
  if(e instanceof z.ZodError)return reply({error:'Malformed Husher action.',code:'HUSHER_INVALID_INPUT',canRetryCreate:false,canResubmit:false},400);
  const message=e instanceof Error?e.message:'',status=publicFailures.get(message);
  if(message==='Sign in as the Husher integration owner.')return reply({error:message,code:'HUSHER_SESSION_REQUIRED',canRetryCreate:false,canResubmit:false},400,'auth-failed');
  if(status)return reply({error:message,code:'HUSHER_ACTION_STOPPED',canRetryCreate:false,canResubmit:false},status,operationalReason(e));
  return reply({error:'Husher operation could not be verified. Check your saved order or transaction before trying again. Do not repeat creation or sending.',code:'HUSHER_UNVERIFIED',canRetryCreate:false,canResubmit:false},503,operationalReason(e));
 }
}


