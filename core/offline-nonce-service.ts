import {sha256} from 'ethers';
import bs58 from 'bs58';
import type {WalletSubmissionClaim,WalletSubmissionStore} from './wallet-submission-ledger';
import {z} from 'zod';
import {Connection,PublicKey,NONCE_ACCOUNT_LENGTH,VersionedTransaction,Transaction,SystemInstruction} from '@solana/web3.js';
import {multiPublicSchema,SOLANA_GENESIS} from './multi-protocol';
import {checkNonceAccount} from './nonce-setup-service';
import {checkSolanaCluster} from './multi-online';
import {solanaEvidence} from './transaction-evidence';
import {nonceAddress,nonceSeed,unsignedNonceBytes,noncePublicKey} from './nonce-setup-protocol';
import {OFFLINE_NONCE_TTL,offlineNonceSchema,offlineNonceTransaction,offlineNonceFingerprint,validateOfflineNonce,verifyOfflineNonceResponse,type OfflineNonceRequest} from './offline-nonce-protocol';
const wallet=multiPublicSchema;
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('check'),wallet,address:noncePublicKey.optional()}).strict(),
 z.object({action:z.literal('prepare'),wallet}).strict(),
 z.object({action:z.literal('preflight'),wallet,request:offlineNonceSchema,response:z.unknown()}).strict(),
 z.object({action:z.literal('status'),wallet,request:offlineNonceSchema,response:z.unknown()}).strict(),
 z.object({action:z.literal('submit'),wallet,request:offlineNonceSchema,response:z.unknown(),consent:z.literal(true)}).strict(),
]);
async function fresh(r:OfflineNonceRequest,c:Connection){
 await validateOfflineNonce(r);await checkSolanaCluster(c);
 if(!(await c.isBlockhashValid(r.blockhash,{commitment:'confirmed'})).value||await c.getBlockHeight('confirmed')>r.lastValidBlockHeight)throw Error('Nonce setup blockhash expired. Obtain new offline approval.');
 if(await c.getAccountInfo(new PublicKey(r.nonceAccount),'confirmed'))throw Error('Nonce destination already exists. Reconcile before creating another request.');
 const rent=await c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH,'confirmed'),fee=(await c.getFeeForMessage(offlineNonceTransaction(r).compileMessage(),'confirmed')).value;
 if(rent!==r.depositLamports||fee!==r.maximumFee)throw Error('Nonce rent or network fee changed. Obtain new offline approval.');
 if(await c.getBalance(new PublicKey(r.from),'confirmed')<rent+fee)throw Error('Offline wallet needs enough SOL for the exact nonce deposit and fee.');
}
export async function offlineNonceAction(input:unknown,c:Connection,enabled=false,store?:WalletSubmissionStore){
 const a=schema.parse(input);await checkSolanaCluster(c);
 if(a.action==='check'){
  const address=a.address??await nonceAddress(a.wallet.solanaAddress,a.wallet.solanaAddress);
  return {...await checkNonceAccount(c,address,a.wallet.solanaAddress),enabled};
 }
 if(a.action==='prepare'){
  const from=a.wallet.solanaAddress,nonceAccount=await nonceAddress(from,from),account=await checkNonceAccount(c,nonceAccount,from);
  if(account.state==='ready')return {...account,enabled};
  const latest=await c.getLatestBlockhash('confirmed'),now=Date.now();
  const r:OfflineNonceRequest={version:5,kind:'nonce-setup',network:'solana',genesisHash:SOLANA_GENESIS,requestId:crypto.randomUUID(),deviceId:a.wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+OFFLINE_NONCE_TTL).toISOString(),from,nonceAccount,seed:nonceSeed(from),depositLamports:await c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH,'confirmed'),maximumFee:5000,...latest,unsignedTransaction:'',fingerprint:'0x'+'00'.repeat(32)};
  r.unsignedTransaction=unsignedNonceBytes(offlineNonceTransaction(r));const fee=(await c.getFeeForMessage(offlineNonceTransaction(r).compileMessage(),'confirmed')).value;if(fee===null)throw Error('Nonce setup fee unavailable.');r.maximumFee=fee;r.fingerprint=offlineNonceFingerprint(r);await fresh(r,c);return {state:'prepared',request:r,enabled};
 }
 const r=await validateOfflineNonce(a.request,Date.now(),false),s=await verifyOfflineNonceResponse(a.response,r,a.wallet,Date.now(),false);
 const evidence=await solanaEvidence(s.transactionHash,s.rawSignedTransaction,c);
 if(evidence.state!=='unknown'){
  if(evidence.state==='confirmed'){const account=await checkNonceAccount(c,r.nonceAccount,r.from);if(account.state!=='ready')throw Error('Matching transaction finalized but nonce account is not ready.');return {...evidence,address:account.address,authority:account.authority};}
  return evidence;
 }
 if(a.action==='status'){
  // Finalized expiry is read-only evidence; it never releases the durable destination reservation.
  if(!(await c.isBlockhashValid(r.blockhash,{commitment:'finalized'})).value&&await c.getBlockHeight('finalized')>r.lastValidBlockHeight&&!(await c.getAccountInfo(new PublicKey(r.nonceAccount),'finalized')))return {state:'expired',hash:s.transactionHash,message:'Original blockhash is finalized-expired and no nonce account was found. No settlement is claimed. Any existing durable destination reservation remains in force; no automatic release or retry.'};
  return evidence;
 }
 if(a.action==='submit'&&!enabled)throw Error('Offline nonce submission requires verified new-ISO acceptance.');

 const raw=Buffer.from(s.rawSignedTransaction,'base64'),tx=Transaction.from(raw),creation=SystemInstruction.decodeCreateWithSeed(tx.instructions[0]),initialize=SystemInstruction.decodeNonceInitialize(tx.instructions[1]);
 const record:WalletSubmissionClaim={version:1,kind:'solana-setup',purpose:'nonce-setup',protocolVersion:r.version,genesis:r.genesisHash,from:tx.feePayer!.toBase58(),signature:bs58.encode(tx.signature!),destination:creation.newAccountPubkey.toBase58(),authority:initialize.authorizedPubkey.toBase58(),blockhash:tx.recentBlockhash!,lastValidBlockHeight:r.lastValidBlockHeight,fingerprint:r.fingerprint,signedBytesDigest:sha256(raw),expiresAt:r.expiresAt};
 const identity={family:'solana' as const,genesis:record.genesis,signature:record.signature};
 const matches=(v:WalletSubmissionClaim)=>Object.keys(v).length===Object.keys(record).length&&Object.entries(record).every(([k,x])=>x===(v as Record<string,unknown>)[k]);
 const uncertain={state:'unknown' as const,hash:s.transactionHash,canResubmit:false,message:'Nonce submission or destination already claimed. Reconcile this exact signature; no automatic retry or reservation release.'};
 if(a.action==='submit'){
  if(!store)throw Error('Durable wallet submission storage is required before broadcasting.');
  const previous=await store.read(identity);if(previous){if(!matches(previous))throw Error('Submission journal identity differs. Reconcile before continuing.');return uncertain;}
 }
 await fresh(r,c);await verifyOfflineNonceResponse(s,r,a.wallet);
 const simulation=await c.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(s.rawSignedTransaction,'base64')),{sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed'});
 if(simulation.value.err)throw Error('Exact signed nonce creation simulation failed.');
 await fresh(r,c);await verifyOfflineNonceResponse(s,r,a.wallet);
 if(a.action==='preflight')return {state:'ready',hash:s.transactionHash,enabled};
 if(!store)throw Error('Durable wallet submission storage is required before broadcasting.');
 if(!await store.claim(record))return uncertain;
 const persisted=await store.read(identity);
 if(!persisted||!matches(persisted))throw Error('Submission intent could not be verified in durable storage.');
 // DB latency must not extend either blockhash validity or the offline approval window.
 await fresh(r,c);await verifyOfflineNonceResponse(s,r,a.wallet);
 try{const hash=await c.sendRawTransaction(Buffer.from(s.rawSignedTransaction,'base64'),{skipPreflight:false,maxRetries:0,preflightCommitment:'confirmed'});if(hash!==s.transactionHash)throw Error('Unexpected signature.');return {state:'submitted',hash};}
 catch{return {state:'unknown',hash:s.transactionHash,canResubmit:false,message:'Submission uncertain. Reconcile this signature; no automatic retry.'};}
}
