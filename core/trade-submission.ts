import { validateTrade,verifyTradeResponse } from './trade-protocol';
import { preflightTrade,tradeStatus } from './trade-online';
import type { Rpc } from './protocol';
export type TradeAttempt={hash:string;fingerprint:string;state:'unknown'|'submitted'|'confirmed'|'failed'|'expired'};
// Caller must supply exclusive per-wallet/network locking and durable storage.
// No production endpoint enables this engine in the release candidate.
export async function submitTrade(input:{request:unknown;response:unknown;wallet:unknown;consent:boolean},rpc:Rpc,store:{read():Promise<TradeAttempt|null>;write(value:TradeAttempt):Promise<void>},accepted:boolean){
 // Expiry prevents a new send, not reconciliation of bytes already submitted.
 const s=verifyTradeResponse(input.response,input.request,input.wallet,Date.now(),false);
 const old=await store.read();
 if(old){if(old.hash!==s.transactionHash||old.fingerprint!==s.fingerprint)throw Error('Another transaction must be reconciled first.');const state=await tradeStatus(old.hash,rpc,s.rawSignedTransaction);if(['confirmed','failed','submitted'].includes(state.state))await store.write({...old,state:state.state as TradeAttempt['state']});return state;}
 if(!accepted||input.consent!==true)throw Error('Submission acceptance and explicit consent required.');
 await preflightTrade(input.request,s,input.wallet,rpc);
 const attempt:TradeAttempt={hash:s.transactionHash,fingerprint:s.fingerprint,state:'unknown'};
 await store.write(attempt);const persisted=await store.read();if(persisted?.hash!==attempt.hash||persisted.fingerprint!==attempt.fingerprint||persisted.state!=='unknown')throw Error('Submission intent could not be persisted.');
 // Storage and network checks may have taken us past the approved deadline.
 const r=validateTrade(input.request,Date.now(),false);
 if(Date.now()>=Date.parse(r.expiresAt)){await store.write({...attempt,state:'expired'});return {state:'expired',hash:s.transactionHash,message:'Request expired before submission. Obtain a fresh offline approval.'};}
 try{const hash=await rpc('eth_sendRawTransaction',[s.rawSignedTransaction]);if(hash!==s.transactionHash)throw Error('Unexpected hash.');await store.write({...attempt,state:'submitted'});return {state:'submitted',hash};}
 catch{return {state:'unknown',hash:s.transactionHash,message:'Submission outcome unknown. Reconcile the exact hash; no automatic retry.'};}
}
