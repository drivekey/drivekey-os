import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {rulesRuntime,reportedRules,previewRulesApplication} from '@/core/rules-online';
import {authenticateRulesAgent} from '@/core/rules-executor';
import {sameRequestOrigin} from '@/core/http-origin';
import {rulesPaymentSchema,verifySignedRulesPayment,validateRulesApproval} from '@/core/rules-protocol';
import {Contract} from 'ethers';
import {liveExecutionEnabled,LIVE_RELEASE_BLOCK} from '@/core/live-release-policy';
import {AgentApiLimits} from '@/core/agent-api-limits';
export const runtime='nodejs';
const id=z.string().regex(/^[a-z0-9-]{1,80}$/);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('read')}).strict(),
 z.object({action:z.literal('verify'),authorization:z.unknown()}).strict(),
 z.object({action:z.literal('apply'),id,authorization:z.unknown(),explicitApply:z.literal(true)}).strict(),
 z.object({action:z.literal('stop'),id}).strict(),
 z.object({action:z.literal('request-payment'),id,payment:rulesPaymentSchema.omit({revision:true,safetyEpoch:true})}).strict(),
 z.object({action:z.literal('status'),id}).strict(),
 z.object({action:z.literal('operator-status'),id}).strict(),
 z.object({action:z.literal('export-approval'),id}).strict(),
 z.object({action:z.literal('submit-approval'),id,approval:z.unknown()}).strict(),
]);
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
const limits=new AgentApiLimits();
export async function GET(){let configured=false;try{configured=!!rulesRuntime();}catch{/* Invalid runtime is unavailable. */}return reply({configured,enabled:liveExecutionEnabled('agents'),version:'RC20',message:liveExecutionEnabled('agents')?'Private rules companion configured.':LIVE_RELEASE_BLOCK.error});}
export async function POST(req:NextRequest){
 if(!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol))return reply({error:'Cross-origin request rejected.'},403);
 try{
  const r=rulesRuntime();if(!r)return reply({error:'Verified private companion is not configured.'},503);
  const reader=req.body?.getReader();if(!reader)throw Error('Missing request.');let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw Error('Request too large.');}chunks.push(value);}
  const c=command.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),credential=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  const agent=['request-payment','status'].includes(c.action);
  try{authenticateRulesAgent(credential,agent?r.agentCredential:r.operatorCredential);}
  catch{
   const allowed=limits.rejectedRequest(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local');
   return reply({error:allowed?'Agent authentication failed.':'Too many invalid requests. Try again shortly.'},allowed?401:429);
  }
  if(!limits.authenticatedAction(c.action,agent?'agent':'operator'))return reply({error:'Too many requests. Try again shortly. Protective stop remains available.'},429);
  // Read/reconcile and the authenticated protective stop remain available.
  if(['apply','request-payment','submit-approval'].includes(c.action)&&!liveExecutionEnabled('agents'))return reply(LIVE_RELEASE_BLOCK,503);
  if(c.action==='read')return reply({...await reportedRules(r.executor.provider,r.executor.pins),history:await r.executor.history()});
  if(c.action==='verify')return reply(await previewRulesApplication(c.authorization,r.executor.provider,r.executor.pins));
  if(c.action==='apply')return reply(await r.executor.submit(c.id,{kind:'apply',authorization:c.authorization,explicitApply:true}));
  if(c.action==='stop')return reply(await r.guardianExecutor.submit(c.id,{kind:'stop'}));
  if(c.action==='request-payment')return reply(await r.agentExecutor.submit(c.id,{kind:'payment',payment:c.payment}));
  if(c.action==='submit-approval'){
   const s=verifySignedRulesPayment(c.approval);if(s.request.context.account.toLowerCase()!==r.agentExecutor.pins.account.toLowerCase())throw Error('Wrong payment account.');
   return reply(await r.agentExecutor.submit(c.id,{kind:'approved-payment',payment:s.request.payment,signature:s.signature}));
  }
  if(c.action==='export-approval'){
   const record=await r.agentExecutor.status(c.id);if(record.operation.kind!=='payment')throw Error('Not a payment request.');
   const {context}=await reportedRules(r.executor.provider,r.executor.pins);
   const account=new Contract(context.account,['function pending(bytes32) view returns(address asset,address recipient,uint256 amount,uint8 category,uint256 revision,uint256 epoch,uint256 expiry,bool exists)'],r.executor.provider);
   const p=await account.pending(record.operation.payment.paymentId);if(!p.exists)throw Error('No pending payment approval.');
   return reply(validateRulesApproval({kind:'drivekey-rules-payment-approval',version:1,context,payment:{paymentId:record.operation.payment.paymentId,asset:p.asset,recipient:p.recipient,amount:String(p.amount),category:Number(p.category),revision:Number(p.revision),safetyEpoch:Number(p.epoch),expiry:Number(p.expiry)}}));
  }
  if(c.action==='operator-status')return reply(await r.executor.reconcile(c.id));
  return reply(await r.agentExecutor.reconcile(c.id));
 }catch(error){
  const allowed=limits.rejectedRequest(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local');
  return reply({error:!allowed?'Too many invalid requests. Try again shortly.':error instanceof z.ZodError?'Malformed rules command.':'Rules action could not be verified. Reconcile any saved submission before retrying.'},allowed?400:429);
 }
}
