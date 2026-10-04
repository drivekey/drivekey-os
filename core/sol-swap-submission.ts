// Acceptance-gated engine. Caller must hold the wallet/network lock through completion.
import type {Connection} from '@solana/web3.js';
import type {AttemptStore} from './trade-journal';
import type {TradeAttempt} from './trade-submission';
import {validateSolSwap,verifySolSwapResponse} from './sol-swap-protocol';
import {preflightSolSwap,solSwapStatus} from './sol-swap-online';
export async function submitSolSwap(input:{request:unknown;response:unknown;wallet:unknown;consent:boolean},c:Connection,store:AttemptStore,accepted:boolean){
 const s=verifySolSwapResponse(input.response,input.request,input.wallet,Date.now(),false),old=await store.read();
 if(old){
  if(old.hash!==s.transactionHash||old.fingerprint!==s.fingerprint)throw Error('Another transaction must be reconciled first.');
  if(old.state==='expired')return {state:'expired',hash:s.transactionHash,message:'This attempt expired before sending. No automatic retry.'};
  const status=await solSwapStatus(input.request,s,input.wallet,c);
  if(['confirmed','failed','submitted'].includes(status.state))await store.write({...old,state:status.state as TradeAttempt['state']});
  return status;
 }
 if(!accepted||input.consent!==true)throw Error('Submission acceptance and explicit consent required.');
 await preflightSolSwap(input.request,s,input.wallet,c);
 const attempt:TradeAttempt={hash:s.transactionHash,fingerprint:s.fingerprint,state:'unknown'};
 await store.write(attempt);const saved=await store.read();
 if(saved?.hash!==attempt.hash||saved.fingerprint!==attempt.fingerprint||saved.state!=='unknown')throw Error('Submission intent could not be persisted.');
 const r=validateSolSwap(input.request,Date.now(),false);
 if(Date.now()>=Date.parse(r.expiresAt)){await store.write({...attempt,state:'expired'});return {state:'expired',hash:s.transactionHash,message:'Expired before sending. Obtain fresh offline approval.'};}
 try{
  const hash=await c.sendRawTransaction(Buffer.from(s.rawSignedTransaction,'base64'),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});
  if(hash!==s.transactionHash)throw Error('Unexpected transaction signature.');
  await store.write({...attempt,state:'submitted'});return {state:'submitted',hash};
 }catch{return {state:'unknown',hash:s.transactionHash,message:'Submission outcome unknown. Reconcile the exact signature; never automatically retry.'};}
}
