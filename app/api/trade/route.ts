import {withServiceTelemetry,tagServiceResponse,operationalReason} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {serverSolanaConnection} from '@/core/solana-rpc';
import {WalletSubmissionLedger} from '@/core/wallet-submission-ledger';
import {publicRpcUrl} from '@/core/public-provider';
import {validatePaymentRequest} from '@/core/payment-request';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { sameRequestOrigin } from '@/core/http-origin';
import { prepareTrade,preflightTrade,tradeStatus } from '@/core/trade-online';
import { inspectJupiterBuild } from '@/core/jupiter-build';
import { verifyTradeResponse } from '@/core/trade-protocol';
import { paymentReceipt } from '@/core/payment-receipt';
import {solSwapStatus} from '@/core/sol-swap-online';
import {validateSolSwap,verifySolSwapResponse} from '@/core/sol-swap-protocol';
import {prepareExpiringJupiter,preflightExpiringJupiter,expiringJupiterStatus} from '@/core/jupiter-expiring-online';
import {isExpiringJupiterShape,validateExpiringJupiter,verifyExpiringJupiterResponse} from '@/core/jupiter-expiring-protocol';
import {prepareNonceControl,preflightNonceControl,nonceControlStatus} from '@/core/solana-nonce-control-online';
import {isNonceControlShape} from '@/core/solana-nonce-control';
import {DEADLINE_GUARD_RELEASE,requireDeadlineGuard} from '@/core/solana-deadline-guard';
import {JupiterNonceLedger} from '@/core/jupiter-nonce-ledger';
import {husherOwnerCookie,requireHusherOwner} from '@/core/husher-owner';
import {husherServer} from '@/core/husher-server';
import {multiPublicSchema} from '@/core/multi-protocol';
import {submitTradeTransport,TradeReleaseBlocked} from '@/core/trade-transport';
import {PAYMENT_PATHS,paymentExecutionEnabled,LIVE_RELEASE_BLOCK} from '@/core/live-release-policy';

import {isSolPayment} from '@/core/sol-payment-protocol';
import {preflightSolPayment,solPaymentStatus} from '@/core/sol-payment-transport';

import type { Rpc } from '@/core/protocol';
import {boundedRpcCall} from '@/core/rpc-proxy';
export const runtime='nodejs';
const methods=new Set(['eth_getCode','eth_getStorageAt','eth_chainId','eth_call','eth_getTransactionCount','eth_estimateGas','eth_getBlockByNumber','eth_maxPriorityFeePerGas','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash']);
const ethereumRpc=async(method:string,params:unknown[]=[],write=false)=>{
 if(!methods.has(method)&&!(write&&method==='eth_sendRawTransaction'))throw Error('RPC method unavailable in release candidate.');
 const url=process.env.ETHEREUM_RPC_URL;if(!url)throw Error('ETHEREUM_RPC_URL is not configured on the server.');
 return boundedRpcCall(url,method,params);
};
const rpc:Rpc=(method,params=[])=>ethereumRpc(method,params);
const envelope=z.object({action:z.enum(['prepare','prepare-sol-swap','prepare-sol-nonce-invalidate','preflight','status','submit','jupiter-build','payment-status']),input:z.unknown()}).strict();
const solConnection=()=>serverSolanaConnection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
const signed=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown()}).strict();
const limits=new Map<string,{count:number;until:number}>();
export async function GET(){return NextResponse.json({release:'windows-unfunded-candidate',paths:PAYMENT_PATHS,swapBroadcastEnabled:{ethereum:PAYMENT_PATHS['ethereum-swap'].enabled,solToUsdc:PAYMENT_PATHS['solana-swap-sol-usdc'].enabled,usdcToSol:PAYMENT_PATHS['solana-swap-usdc-sol'].enabled},ethereum:{pairs:['WETH/USDC','USDC/WETH'],offlineSigning:true,settlementVerified:false,rpcConfigured:!!process.env.ETHEREUM_RPC_URL},solana:{pairs:['SOL/USDC','USDC/SOL'],offlineSigning:true,onlinePreparation:!!DEADLINE_GUARD_RELEASE,providerAccess:process.env.JUPITER_API_KEY?'authenticated':'unconfigured',settlementVerified:false,apiConfigured:!!process.env.JUPITER_API_KEY,missing:[...(!DEADLINE_GUARD_RELEASE?['Reviewed immutable deadline guard']:[]),...(!process.env.JUPITER_API_KEY?['Jupiter API access']:[])],ownerSessionRequired:true},husher:{enabled:false}},{headers:{'Cache-Control':'no-store'}});}
async function privateNonceLifecycle(req:NextRequest){
 // Reuse the existing private operator session, also used by operator alerts.
 // Public addresses must never grant permission to reserve another user's nonce.
 await requireHusherOwner(req.cookies.get(husherOwnerCookie)?.value,husherServer().store);
 const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;
 if(!url||!scope)throw Error('Private durable nonce journal is not configured.');
 return new JupiterNonceLedger(url,scope);
}
async function handlePost(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol))return reply({error:'Cross-origin action refused.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 const now=Date.now();for(const [key,value] of limits)if(value.until<now)limits.delete(key);
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local';
 if(limits.size>10000)return reply({error:'Service busy.'},429);
 const limit=limits.get(ip)||{count:0,until:now+60000};limits.set(ip,limit);if(++limit.count>30)return reply({error:'Rate limited. Try again shortly.'},429);
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Missing body.');let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw Error('Request too large.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  const a=envelope.parse(JSON.parse(text));
  if(a.action==='submit'&&!paymentExecutionEnabled((a.input as {request?:unknown})?.request))return reply(LIVE_RELEASE_BLOCK,503);
 const sharedLimit=await serviceRateLimitHttp('trade',reply);if(sharedLimit)return sharedLimit;
  if(a.action==='submit'){const request=(a.input as {request?:unknown})?.request;if(isExpiringJupiterShape(request)||isNonceControlShape(request))await privateNonceLifecycle(req);const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;if(!url||!scope)throw Error('Durable wallet submission storage is not configured.');return reply(await submitTradeTransport(a.input,{ethereum:(method,params=[])=>ethereumRpc(method,params,true),solana:solConnection},paymentExecutionEnabled(request),new WalletSubmissionLedger(url,scope)));}
  if(a.action==='prepare')return reply(await prepareTrade(a.input,rpc));
  if(a.action==='prepare-sol-swap'){requireDeadlineGuard();const lifecycle=await privateNonceLifecycle(req);return reply(await prepareExpiringJupiter(a.input,solConnection(),process.env.JUPITER_API_KEY,lifecycle));}
  if(a.action==='prepare-sol-nonce-invalidate'){
   await privateNonceLifecycle(req);
   const input=z.object({targetRequest:z.unknown(),targetResponse:z.unknown().optional(),wallet:multiPublicSchema}).strict().parse(a.input);
   const guarded=isExpiringJupiterShape(input.targetRequest),target=guarded?validateExpiringJupiter(input.targetRequest,Date.now(),false):validateSolSwap(input.targetRequest,Date.now(),false);
   if(target.deviceId!==input.wallet.deviceId||target.from!==input.wallet.solanaAddress)throw Error('Original approval belongs to a different wallet.');
   const response=input.targetResponse==null?null:guarded?verifyExpiringJupiterResponse(input.targetResponse,target,input.wallet,Date.now(),false):verifySolSwapResponse(input.targetResponse,target,input.wallet,Date.now(),false);
   return reply(await prepareNonceControl(input.wallet,target.nonceAccount,target.nonceValue,target.fingerprint,response?.transactionHash??null,solConnection()));
  }
  if(a.action==='jupiter-build')return reply(await inspectJupiterBuild(a.input,process.env.JUPITER_API_KEY));
  if(a.action==='payment-status'){const p=z.object({request:z.unknown(),hash:z.string().max(90)}).strict().parse(a.input);return reply(await paymentReceipt(p.request,p.hash,validatePaymentRequest(p.request).network==='robinhood'?async(method,params=[])=>{if(!methods.has(method))throw Error('Read-only RPC required.');return boundedRpcCall(publicRpcUrl('robinhood'),method,params);}:rpc,serverSolanaConnection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com','finalized')));}
  const s=signed.parse(a.input);
  if(isNonceControlShape(s.request))return reply(a.action==='status'?await nonceControlStatus(s.request,s.response,s.wallet,solConnection()):{...await preflightNonceControl(s.request,s.response,s.wallet,solConnection()),broadcastEnabled:false});
  if(isExpiringJupiterShape(s.request))return reply(a.action==='status'?await expiringJupiterStatus(s.request,s.response,s.wallet,solConnection()):{...await preflightExpiringJupiter(s.request,s.response,s.wallet,solConnection()),broadcastEnabled:paymentExecutionEnabled(s.request)});
  if(isSolPayment(s.request))return reply(a.action==='status'?await solPaymentStatus(s,solConnection()):{...await preflightSolPayment(s,solConnection()),broadcastEnabled:paymentExecutionEnabled(s.request),message:'Exact signed transfer preflight passed. Explicit submission is required.'});
  if(s.request&&typeof s.request==='object'&&'network' in s.request&&s.request.network==='solana'){
   const connection=serverSolanaConnection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com','confirmed');
   if(a.action!=='status')throw Error('Legacy v4 swaps are reconciliation-only. Prepare a guarded swap after release acceptance.');
   return reply(await solSwapStatus(s.request,s.response,s.wallet,connection));
  }
  const verified=verifyTradeResponse(s.response,s.request,s.wallet,Date.now(),a.action!=='status');
  if(a.action==='status')return reply(await tradeStatus(verified.transactionHash,rpc,verified.rawSignedTransaction));
  return reply({...await preflightTrade(s.request,s.response,s.wallet,rpc),broadcastEnabled:paymentExecutionEnabled(s.request),message:'Exact preflight passed. Submission requires acceptance for this path.'});
 }catch(e){return tagServiceResponse(reply({error:e instanceof z.ZodError?'Malformed trade action.':e instanceof Error?e.message:'Action stopped.'},e instanceof TradeReleaseBlocked?503:400),operationalReason(e));}
}







export const POST=withServiceTelemetry('trade',handlePost);
