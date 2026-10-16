import {PublicKey,VersionedMessage,VersionedTransaction,type Connection} from '@solana/web3.js';
import {prepareSolSwap} from './sol-swap-prepare';
import {checkSolSwapState} from './sol-swap-online';
import {buildExpiringJupiterMessage,expiringJupiterFingerprint,validateExpiringJupiter,verifyExpiringJupiterResponse,type ExpiringJupiterRequest} from './jupiter-expiring-protocol';
import {requireDeadlineGuard,type DeadlineGuardIdentity} from './solana-deadline-guard';
import {solSwapDeliveryEvidence} from './sol-swap-delivery';

export interface JupiterNonceLifecycle {
 // This must query durable public workflow state. Application expiry alone must
 // never release a previously exported/signed nonce for another transaction.
 assertAvailable(input:{genesis:string;owner:string;nonceAccount:string;nonceValue:string}):Promise<void>;
 reserve(input:{genesis:string;owner:string;nonceAccount:string;nonceValue:string;requestFingerprint:string;expiresAt:string}):Promise<boolean>;
}
export async function prepareExpiringJupiter(input:unknown,c:Connection,key:string|undefined,lifecycle:JupiterNonceLifecycle,fetcher:typeof fetch=fetch,acceptedGuard?:DeadlineGuardIdentity){
 const guard=requireDeadlineGuard(acceptedGuard);
 if(!lifecycle||typeof lifecycle.assertAvailable!=='function'||typeof lifecycle.reserve!=='function')throw Error('Durable nonce lifecycle verification is required before preparing a swap.');
 const legacy=await prepareSolSwap(input,c,key,fetcher);
 const r:ExpiringJupiterRequest={...legacy.request,version:1,kind:'jupiter-expiring-swap',guard};
 await lifecycle.assertAvailable({genesis:r.genesisHash,owner:r.from,nonceAccount:r.nonceAccount,nonceValue:r.nonceValue});
 r.unsignedMessage=Buffer.from(buildExpiringJupiterMessage(r).serialize()).toString('base64');r.fingerprint=expiringJupiterFingerprint(r);validateExpiringJupiter(r,Date.now(),true,guard);
 const tx=new VersionedTransaction(VersionedMessage.deserialize(Buffer.from(r.unsignedMessage,'base64')));
 const checked=await checkSolSwapState(r,tx,c,false,guard);
 await lifecycle.assertAvailable({genesis:r.genesisHash,owner:r.from,nonceAccount:r.nonceAccount,nonceValue:r.nonceValue});
 if(!await lifecycle.reserve({genesis:r.genesisHash,owner:r.from,nonceAccount:r.nonceAccount,nonceValue:r.nonceValue,requestFingerprint:r.fingerprint,expiresAt:r.expiresAt}))throw Error('This nonce is already reserved. Reconcile or invalidate the prior approval.');
 return {state:'prepared',request:validateExpiringJupiter(r,Date.now(),true,guard),broadcastEnabled:false,deadlineEnforcement:'on-chain',...checked};
}
export async function preflightExpiringJupiter(request:unknown,response:unknown,wallet:unknown,c:Connection,acceptedGuard?:DeadlineGuardIdentity){
 const r=validateExpiringJupiter(request,Date.now(),true,acceptedGuard),s=verifyExpiringJupiterResponse(response,r,wallet,Date.now(),true,acceptedGuard),tx=VersionedTransaction.deserialize(Buffer.from(s.rawSignedTransaction,'base64'));
 const checked=await checkSolSwapState(r,tx,c,true,acceptedGuard);return {state:'ready',hash:s.transactionHash,broadcastEnabled:false,...checked};
}
export async function expiringJupiterStatus(request:unknown,response:unknown,wallet:unknown,c:Connection,acceptedGuard?:DeadlineGuardIdentity){
 const r=validateExpiringJupiter(request,Date.now(),false,acceptedGuard),s=verifyExpiringJupiterResponse(response,r,wallet,Date.now(),false,acceptedGuard);
 if(await c.getGenesisHash()!==r.genesisHash)throw Error('Wrong Solana network.');
 const result=await solSwapDeliveryEvidence(r,s.rawSignedTransaction,s.transactionHash,c);
 // Never label a local clock timeout as on-chain cancellation or nonce reuse.
 return {...result,applicationDeadlinePassed:Date.now()>=Date.parse(r.expiresAt),nonceReuse:'requires-finalized-reconciliation' as const};
}
