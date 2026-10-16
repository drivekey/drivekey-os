import {z} from 'zod';
import {Transaction,sha256} from 'ethers';
import type {Rpc} from './protocol';
import type {WalletSubmissionClaim,WalletSubmissionStore} from './wallet-submission-ledger';
import {validateWethConversion,verifyWethConversionResponse} from './weth-conversion-protocol';
import {preflightWethConversion,wethConversionStatus} from './weth-conversion-online';
const envelope=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown(),consent:z.literal(true)}).strict();
const recovery=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown()}).strict();
function context(input:z.infer<typeof recovery>){
 const r=validateWethConversion(input.request,Date.now(),false),s=verifyWethConversionResponse(input.response,r,input.wallet,Date.now(),false),tx=Transaction.from(s.rawSignedTransaction);
 const claim:WalletSubmissionClaim={version:1,protocolVersion:r.version,kind:'evm',purpose:'weth-conversion',chainId:Number(tx.chainId),from:tx.from!.toLowerCase(),nonce:tx.nonce,hash:tx.hash!,fingerprint:r.fingerprint,signedBytesDigest:sha256(s.rawSignedTransaction),expiresAt:r.expiresAt};
 return {r,s,claim,identity:{family:'evm' as const,chainId:Number(tx.chainId),hash:tx.hash!},matches:(value:WalletSubmissionClaim)=>Object.keys(value).length===Object.keys(claim).length&&Object.entries(claim).every(([key,v])=>v===(value as Record<string,unknown>)[key])};
}
function unknown(hash:string){return {state:'unknown',hash,canResubmit:false,conversionVerified:false,swapCompleted:false,message:'Conversion submission claimed or outcome unknown. Reconcile the exact transaction; do not resend or replace it.'};}
/** Read-only recovery is allowed after application expiry; never releases claims. */
export async function reconcileWethConversion(input:unknown,rpc:Rpc,store:WalletSubmissionStore){
 const a=recovery.parse(input),c=context(a),previous=await store.read(c.identity);
 if(previous&&!c.matches(previous))throw Error('Conversion journal identity differs.');
 const status=await wethConversionStatus(c.r,c.s,a.wallet,rpc);
 return status.state==='unknown'&&previous?unknown(c.s.transactionHash):{...status,canResubmit:false,claimPresent:!!previous};
}
/** Dedicated transport; callers must supply an accepted release, explicit
 * consent and the SAME durable ledger scope used by every EVM payment route.
 * No retry, update/delete or timeout release. Raw signed bytes never enter DB. */
export async function submitWethConversion(input:unknown,rpc:Rpc,accepted:boolean,store?:WalletSubmissionStore){
 if(!accepted)throw Error('WETH conversion funded release is blocked.');
 const a=envelope.parse(input),c=context(a);
 if(!store)throw Error('Durable shared wallet submission storage is required.');
 const previous=await store.read(c.identity);if(previous&&!c.matches(previous))throw Error('Conversion journal identity differs.');
 const status=await wethConversionStatus(c.r,c.s,a.wallet,rpc);
 if(status.state!=='unknown')return {...status,canResubmit:false};
 if(previous)return unknown(c.s.transactionHash);
 await preflightWethConversion(c.r,c.s,a.wallet,rpc);
 verifyWethConversionResponse(c.s,c.r,a.wallet);
 if(!await store.claim(c.claim))return unknown(c.s.transactionHash);
 const saved=await store.read(c.identity);if(!saved||!c.matches(saved))throw Error('Conversion durable claim readback failed; reconcile without retry.');
 // A slow commit cannot authorize sending after the review window closed.
 verifyWethConversionResponse(c.s,c.r,a.wallet);
 try{const hash=await rpc('eth_sendRawTransaction',[c.s.rawSignedTransaction]);if(hash!==c.s.transactionHash)throw Error();return {state:'submitted',hash,canResubmit:false,conversionVerified:false,swapCompleted:false};}
 catch{return unknown(c.s.transactionHash);}
}
