// Browser orchestration; transport endpoints must independently enforce release acceptance.
import {z} from 'zod';
import {validateMultiRequest,verifyMultiResponse} from './multi-protocol';
import {validateTrade,verifyTradeResponse} from './trade-protocol';
import {validateSolSwap,verifySolSwapResponse} from './sol-swap-protocol';
import {withTradeJournal,type AttemptStore} from './trade-journal';
import type {TradeAttempt} from './trade-submission';
export type SignedTradeInput={request:unknown;response:unknown;wallet:unknown};
export type TradeTransport={preflight(input:SignedTradeInput):Promise<unknown>;status(input:SignedTradeInput):Promise<unknown>;submit(input:SignedTradeInput&{consent:true}):Promise<unknown>};
const resultSchema=z.object({state:z.enum(['ready','unknown','submitted','confirmed','failed','expired']),hash:z.string(),message:z.string().optional(),finality:z.string().optional()});
function identity(input:SignedTradeInput){
 const sol=!!input.request&&typeof input.request==='object'&&'network' in input.request&&input.request.network==='solana';
 const payment=!!input.request&&typeof input.request==='object'&&'version' in input.request&&(input.request.version===3||input.request.version===6);
 const r=payment?validateMultiRequest(input.request,Date.now(),false):sol?validateSolSwap(input.request,Date.now(),false):validateTrade(input.request,Date.now(),false);
 const s=payment?verifyMultiResponse(input.response,r,input.wallet,Date.now(),false):sol?verifySolSwapResponse(input.response,r,input.wallet,Date.now(),false):verifyTradeResponse(input.response,r,input.wallet,Date.now(),false);
 return {r,s,scope:r.network+':'+(sol?r.from:r.from.toLowerCase()),fresh:()=>payment?validateMultiRequest(r):sol?validateSolSwap(r):validateTrade(r)};
}
function result(value:unknown,hash:string){const state=resultSchema.parse(value);if(state.hash!==hash)throw Error('Server returned a different transaction identity.');return state;}
async function reconcile(input:SignedTradeInput,status:TradeTransport['status'],store:AttemptStore,hash:string,fingerprint:string){
 const old=await store.read(),state=result(await status(input),hash);
 if(state.state==='ready'||state.state==='expired')throw Error('Invalid on-chain status response.');
 if(['submitted','confirmed','failed'].includes(state.state))await store.write({hash,fingerprint,state:state.state as TradeAttempt['state']});
 // Preserve known finality when a lagging RPC temporarily cannot find a receipt.
 if(state.state==='unknown'&&old&&['confirmed','failed'].includes(old.state))return {...state,state:old.state,message:'Previously finalized result retained; current RPC has no receipt.'};
 return state;
}
export async function recoverBrowserTrade(input:SignedTradeInput,status:TradeTransport['status']){
 const {s,scope}=identity(input);
 return withTradeJournal(scope,s.transactionHash,s.fingerprint,store=>reconcile(input,status,store,s.transactionHash,s.fingerprint));
}
export async function submitBrowserTrade(input:SignedTradeInput&{consent:boolean},transport:TradeTransport,accepted=false){
 const {r,s,scope,fresh}=identity(input);
 return withTradeJournal(scope,s.transactionHash,s.fingerprint,async store=>{
  const old=await store.read();
  if(old){if(old.state==='expired')return {state:'expired',hash:s.transactionHash,message:'Expired before sending; no automatic retry.'};return reconcile(input,transport.status,store,s.transactionHash,s.fingerprint);}
  if(!accepted||input.consent!==true)throw Error('Submission acceptance and explicit consent required.');
  fresh();const checked=result(await transport.preflight(input),s.transactionHash);if(checked.state!=='ready')throw Error('Submission preflight did not pass.');fresh();
  const attempt:TradeAttempt={hash:s.transactionHash,fingerprint:s.fingerprint,state:'unknown'};
  await store.write(attempt);const persisted=await store.read();if(persisted?.hash!==attempt.hash||persisted.fingerprint!==attempt.fingerprint||persisted.state!=='unknown')throw Error('Submission intent could not be persisted.');
  if(Date.now()>=Date.parse(r.expiresAt)){await store.write({...attempt,state:'expired'});return {state:'expired',hash:s.transactionHash,message:'Expired before sending. Obtain fresh offline approval.'};}
  try{
   const sent=result(await transport.submit({...input,consent:true}),s.transactionHash);
   if(!['submitted','confirmed','failed'].includes(sent.state))throw Error('Submission outcome not acknowledged.');
   await store.write({...attempt,state:sent.state as TradeAttempt['state']});return sent;
  }catch{return {state:'unknown',hash:s.transactionHash,message:'Submission outcome unknown. Check the exact transaction status; no automatic retry.'};}
 });
}
