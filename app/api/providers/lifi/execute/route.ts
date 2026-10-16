import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {boundedRpcCall} from '@/core/rpc-proxy';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {liveExecutionEnabled,LIVE_RELEASE_BLOCK} from '@/core/live-release-policy';
import {sameRequestOrigin} from '@/core/http-origin';
import {prepareLifi,preflightLifi,lifiStatus,submitLifi,lifiBoundedJson} from '@/core/lifi-online';
import type {Rpc} from '@/core/protocol';
import {LifiSubmissionLedger} from '@/core/lifi-submission-ledger';
import {WalletSubmissionLedger} from '@/core/wallet-submission-ledger';
import {recordServiceEvent,operationalReason,type OperationalReason} from '@/core/server-service-telemetry';
export const runtime='nodejs';export const maxDuration=60;
const methods=new Set(['eth_chainId','eth_getCode','eth_getStorageAt','eth_call','eth_getTransactionCount','eth_estimateGas','eth_getBlockByNumber','eth_maxPriorityFeePerGas','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash']);
const limits=new Map<string,{count:number;until:number}>();let active=0;
export async function POST(req:NextRequest){
 const requestId=crypto.randomUUID(),started=performance.now();
 const reply=(data:unknown,status=200,reason?:OperationalReason)=>{recordServiceEvent(requestId,status,Math.max(0,performance.now()-started),undefined,'lifi-execute',reason);return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Request-ID':requestId}});};
 if(!req.headers.get('origin')||!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol))return reply({error:'Same-origin action required.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 const now=Date.now();for(const [k,v] of limits)if(v.until<now)limits.delete(k);
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local';if(limits.size>=10000&&!limits.has(ip))return reply({error:'Service busy.'},429);
 const limit=limits.get(ip)||{count:0,until:now+60000};limits.set(ip,limit);if(++limit.count>20||active>=4)return reply({error:'Too many requests. Try again shortly.'},429);
 active++;
 try{
 const a=z.object({action:z.enum(['prepare','preflight','status','submit']),input:z.unknown()}).strict().parse(await lifiBoundedJson(new Response(req.body),60000));
 if(a.action==='submit'&&!liveExecutionEnabled('lifi'))return reply(LIVE_RELEASE_BLOCK,503);
 const sharedLimit=await serviceRateLimitHttp('lifi-execute',reply);if(sharedLimit)return sharedLimit;
 const endpoint=process.env.ETHEREUM_RPC_URL;if(!endpoint)throw Error('Ethereum RPC is not configured.');
 const rpc:Rpc=async(method,params=[])=>{
  if(!methods.has(method)&&!(a.action==='submit'&&method==='eth_sendRawTransaction'))throw Error('Unsupported operation.');
  return boundedRpcCall(endpoint,method,params);
 };
 if(a.action==='prepare')return reply({request:await prepareLifi(a.input,rpc)});
 if(a.action==='preflight')return reply({...await preflightLifi(a.input,rpc),broadcastEnabled:liveExecutionEnabled('lifi')});
 if(a.action==='status')return reply(await lifiStatus(a.input,rpc));
 const database=process.env.LIFI_SUBMISSION_DATABASE_URL,scope=process.env.LIFI_SUBMISSION_SCOPE;
 if(!database||!scope)throw Error('Durable LI.FI submission storage is not configured.');
 const walletDatabase=process.env.WALLET_SUBMISSION_DATABASE_URL,walletScope=process.env.WALLET_SUBMISSION_SCOPE;
 if(!walletDatabase||!walletScope)throw Error('Shared wallet submission storage is not configured.');
 return reply(await submitLifi(a.input,rpc,new LifiSubmissionLedger(database,scope),new WalletSubmissionLedger(walletDatabase,walletScope)));
 }catch(e){return reply({error:e instanceof z.ZodError?'Invalid LI.FI request.':e instanceof Error?e.message:'LI.FI operation failed.'},400,operationalReason(e));}finally{active--;}
}
