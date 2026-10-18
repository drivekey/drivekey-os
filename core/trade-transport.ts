// Server transport: the durable SQL claim is the cross-worker submission authority.
import {z} from 'zod';
import {Transaction,sha256} from 'ethers';
import {VersionedTransaction,TransactionMessage,SystemInstruction,type Connection} from '@solana/web3.js';
import bs58 from 'bs58';
import type {WalletSubmissionStore,WalletSubmissionClaim} from './wallet-submission-ledger';
import {isSolPayment,validateSolPayment} from './sol-payment-protocol';
import {verifyMultiResponse} from './multi-protocol';
import {preflightSolPayment,solPaymentStatus} from './sol-payment-transport';
import type {Rpc} from './protocol';
import {verifyTradeResponse,validateTrade} from './trade-protocol';
import {verifySolSwapResponse,validateSolSwap} from './sol-swap-protocol';
import {preflightTrade,tradeStatus} from './trade-online';
import {preflightSolSwap,solSwapStatus} from './sol-swap-online';
import {isExpiringJupiterShape,validateExpiringJupiter,verifyExpiringJupiterResponse} from './jupiter-expiring-protocol';
import {preflightExpiringJupiter,expiringJupiterStatus} from './jupiter-expiring-online';
import {isNonceControlShape,validateNonceControl,verifyNonceControlResponse} from './solana-nonce-control';
import {preflightNonceControl,nonceControlStatus} from './solana-nonce-control-online';
import {PUBLIC_TRADE_BLOCKER} from './trade-release';
const envelope=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown(),consent:z.literal(true)}).strict();
export class TradeReleaseBlocked extends Error {constructor(){super(PUBLIC_TRADE_BLOCKER);}}
export async function submitTradeTransport(input:unknown,dependencies:{ethereum:Rpc;solana:()=>Connection},accepted:boolean,store?:WalletSubmissionStore){
 if(!accepted)throw new TradeReleaseBlocked();
 const a=envelope.parse(input),sol=!!a.request&&typeof a.request==='object'&&'network' in a.request&&a.request.network==='solana';
 const payment=isSolPayment(a.request);
 const guarded=isExpiringJupiterShape(a.request),invalidation=isNonceControlShape(a.request);
 if(sol&&!payment&&!guarded&&!invalidation)throw Error('Legacy Jupiter swaps are historical only. Prepare a new swap with on-chain expiry.');
 const verify=(expiry=true)=>invalidation?verifyNonceControlResponse(a.response,a.request,a.wallet,Date.now(),expiry):guarded?verifyExpiringJupiterResponse(a.response,a.request,a.wallet,Date.now(),expiry):payment?verifyMultiResponse(a.response,a.request,a.wallet,Date.now(),expiry):verifyTradeResponse(a.response,a.request,a.wallet,Date.now(),expiry);
 const signed=verify(false);
 const r=invalidation?validateNonceControl(a.request,Date.now(),false):guarded?validateExpiringJupiter(a.request,Date.now(),false):payment?validateSolPayment(a.request,Date.now(),false):validateTrade(a.request,Date.now(),false);
 const connection=sol?dependencies.solana():null;
 const status=invalidation?await nonceControlStatus(a.request,signed,a.wallet,connection!):guarded?await expiringJupiterStatus(a.request,signed,a.wallet,connection!):payment?await solPaymentStatus(a,connection!):await tradeStatus(signed.transactionHash,dependencies.ethereum,signed.rawSignedTransaction);
 if(status.state!=='unknown')return status;
 if(!store)throw Error('Durable wallet submission storage is required before broadcasting.');
 const common={version:1 as const,protocolVersion:r.version,fingerprint:r.fingerprint,expiresAt:r.expiresAt};
 let record:WalletSubmissionClaim;
 if(r.network==='solana'){
  const raw=Buffer.from(signed.rawSignedTransaction,'base64'),tx=VersionedTransaction.deserialize(raw),message=TransactionMessage.decompile(tx.message),nonce=SystemInstruction.decodeNonceAdvance(message.instructions[0]);
  record={...common,kind:'solana-durable',purpose:invalidation?'nonce-invalidate':payment?'transfer':'swap',genesis:r.genesisHash,from:message.payerKey.toBase58(),signature:bs58.encode(tx.signatures[0]),nonceAccount:nonce.noncePubkey.toBase58(),authority:nonce.authorizedPubkey.toBase58(),nonceValue:tx.message.recentBlockhash,signedBytesDigest:sha256(raw)};
 }else{
  const tx=Transaction.from(signed.rawSignedTransaction);
  record={...common,kind:'evm',purpose:r.kind==='payment'?'transfer':r.kind,chainId:Number(tx.chainId),from:tx.from!.toLowerCase(),nonce:tx.nonce,hash:tx.hash!.toLowerCase(),signedBytesDigest:sha256(signed.rawSignedTransaction)};
 }
 const identity=record.kind==='evm'?{family:'evm' as const,chainId:record.chainId,hash:record.hash}:{family:'solana' as const,genesis:record.genesis,signature:record.signature};
 const matches=(v:WalletSubmissionClaim)=>Object.keys(v).length===Object.keys(record).length&&Object.entries(record).every(([k,x])=>x===(v as Record<string,unknown>)[k]);
 const uncertain={state:'unknown' as const,hash:signed.transactionHash,canResubmit:false,message:'Submission already claimed or outcome unknown. Reconcile this exact transaction; no automatic retry.'};
 const previous=await store.read(identity);
 if(previous){if(!matches(previous))throw Error('Submission journal identity differs. Reconcile before continuing.');return uncertain;}
 if(invalidation)await preflightNonceControl(a.request,signed,a.wallet,connection!);else if(guarded)await preflightExpiringJupiter(a.request,signed,a.wallet,connection!);else if(payment)await preflightSolPayment(a,connection!);else await preflightTrade(a.request,signed,a.wallet,dependencies.ethereum);
 verify();
 if(!await store.claim(record))return uncertain;
 const persisted=await store.read(identity);
 if(!persisted||!matches(persisted))throw Error('Submission intent could not be verified in durable storage.');
 verify();
 try{
  const hash=sol?await connection!.sendRawTransaction(Buffer.from(signed.rawSignedTransaction,'base64'),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}):await dependencies.ethereum('eth_sendRawTransaction',[signed.rawSignedTransaction]);
  if(hash!==signed.transactionHash)throw Error('Unexpected transaction identity.');
  return {state:'submitted',hash};
 }catch{return uncertain;}
}
