// Server transport. Browser controller must commit intent and hold its wallet lock first.
import {z} from 'zod';
import {isSolPayment,validateSolPayment} from './sol-payment-protocol';
import {verifyMultiResponse} from './multi-protocol';
import {preflightSolPayment,solPaymentStatus} from './sol-payment-transport';
import type {Connection} from '@solana/web3.js';
import type {Rpc} from './protocol';
import {verifyTradeResponse} from './trade-protocol';
import {verifySolSwapResponse} from './sol-swap-protocol';
import {preflightTrade,tradeStatus} from './trade-online';
import {preflightSolSwap,solSwapStatus} from './sol-swap-online';
import {PUBLIC_TRADE_BLOCKER} from './trade-release';
const envelope=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown(),consent:z.literal(true)}).strict();
// Defense in depth within a worker; the browser's durable journal survives server restarts.
const attempted=new Map<string,number>();
const locks=new Map<string,Promise<void>>();
async function exclusive<T>(key:string,operation:()=>Promise<T>){
 const previous=locks.get(key)||Promise.resolve();let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve;});locks.set(key,current);
 try{await previous;return await operation();}finally{release();if(locks.get(key)===current)locks.delete(key);}
}
export class TradeReleaseBlocked extends Error {constructor(){super(PUBLIC_TRADE_BLOCKER);}}
export async function submitTradeTransport(input:unknown,dependencies:{ethereum:Rpc;solana:()=>Connection},accepted:boolean){
 if(!accepted)throw new TradeReleaseBlocked();
 const a=envelope.parse(input),sol=!!a.request&&typeof a.request==='object'&&'network' in a.request&&a.request.network==='solana';
 const payment=isSolPayment(a.request);if(payment)validateSolPayment(a.request);
 const verify=()=>payment?verifyMultiResponse(a.response,a.request,a.wallet):sol?verifySolSwapResponse(a.response,a.request,a.wallet):verifyTradeResponse(a.response,a.request,a.wallet);
 const signed=verify();
 const wallet=z.object({evmAddress:z.string(),solanaAddress:z.string()}).parse(a.wallet);
 const scope=sol?'solana:'+wallet.solanaAddress:'ethereum:'+wallet.evmAddress.toLowerCase();
 return exclusive(scope,async()=>{
  const connection=sol?dependencies.solana():null;
  const status=payment?await solPaymentStatus(a,connection!):sol?await solSwapStatus(a.request,signed,a.wallet,connection!):await tradeStatus(signed.transactionHash,dependencies.ethereum,signed.rawSignedTransaction);
  if(status.state!=='unknown')return status;
  const now=Date.now();for(const [key,expiry] of attempted)if(expiry<=now)attempted.delete(key);
  if(attempted.has(signed.transactionHash))return {state:'unknown',hash:signed.transactionHash,message:'Submission already attempted. Reconcile this exact transaction; no automatic retry.'};
  if(attempted.size>=10000)throw Error('Submission recovery capacity reached.');
  if(payment)await preflightSolPayment(a,connection!);else if(sol)await preflightSolSwap(a.request,signed,a.wallet,connection!);else await preflightTrade(a.request,signed,a.wallet,dependencies.ethereum);
  verify();
  attempted.set(signed.transactionHash,Date.parse((a.request as {expiresAt:string}).expiresAt));
  try{
   const hash=sol?await connection!.sendRawTransaction(Buffer.from(signed.rawSignedTransaction,'base64'),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}):await dependencies.ethereum('eth_sendRawTransaction',[signed.rawSignedTransaction]);
   if(hash!==signed.transactionHash)throw Error('Unexpected transaction identity.');
   return {state:'submitted',hash};
  }catch{return {state:'unknown',hash:signed.transactionHash,message:'Submission outcome unknown. Reconcile this exact transaction; no automatic retry.'};}
 });
}
