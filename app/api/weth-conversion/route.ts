import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {sameRequestOrigin} from '@/core/http-origin';
import {boundedRpcCall} from '@/core/rpc-proxy';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {LIVE_RELEASE_BLOCK,liveExecutionEnabled} from '@/core/live-release-policy';
import {prepareWethConversion,preflightWethConversion} from '@/core/weth-conversion-online';
import {reconcileWethConversion,submitWethConversion} from '@/core/weth-conversion-transport';
import {WalletSubmissionLedger} from '@/core/wallet-submission-ledger';
export const runtime='nodejs';
const envelope=z.object({action:z.enum(['prepare','preflight','status','submit']),input:z.unknown()}).strict();
const signed=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown()}).strict();
const methods=new Set(['eth_getCode','eth_chainId','eth_call','eth_getTransactionCount','eth_estimateGas','eth_getBlockByNumber','eth_maxPriorityFeePerGas','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash']);
const rpc=async(method:string,params:unknown[]=[],write=false)=>{if(!methods.has(method)&&!(write&&method==='eth_sendRawTransaction'))throw Error('Read-only conversion RPC required.');const url=process.env.ETHEREUM_RPC_URL;if(!url)throw Error('Ethereum RPC is not configured.');return boundedRpcCall(url,method,params);};
export async function POST(req:NextRequest){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol))return reply({error:'Cross-origin action refused.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Missing body.');const chunks:Uint8Array[]=[];let size=0;
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;void reader.cancel();},10000);let complete=false;
  try{for(;;){const {done,value}=await reader.read();if(done){complete=true;break;}size+=value.length;if(size>32768)throw Error('Request too large.');chunks.push(value);}}finally{clearTimeout(timer);if(!complete)await reader.cancel();}
  if(timedOut)throw Error('Request timed out.');
  const a=envelope.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
  // This separate protocol requires its own build-bound acceptance. Never fall
  // through the swap or payment transport, including after other paths release.
  if(a.action==='submit'&&!liveExecutionEnabled('weth-conversion'))return reply(LIVE_RELEASE_BLOCK,503);
  const limited=await serviceRateLimitHttp('trade',reply);if(limited)return limited;
  if(a.action==='prepare')return reply(await prepareWethConversion(a.input,rpc));
  if(a.action==='submit'){const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;if(!url||!scope)throw Error('Shared durable conversion submission is unavailable.');return reply(await submitWethConversion(a.input,(method,params=[])=>rpc(method,params,true),liveExecutionEnabled('weth-conversion'),new WalletSubmissionLedger(url,scope)));}
  const s=signed.parse(a.input);
  if(a.action==='status'){
   const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;
   if(!url||!scope)throw Error('Shared durable conversion recovery is unavailable.');
   return reply(await reconcileWethConversion(s,rpc,new WalletSubmissionLedger(url,scope)));
  }
  return reply(await preflightWethConversion(s.request,s.response,s.wallet,rpc));
 }catch{return reply({error:'Conversion stopped. Check the exact files, configured RPC, balances, fees and request validity.'},400);}
}
