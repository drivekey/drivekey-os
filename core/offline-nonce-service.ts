import {z} from 'zod';
import {Connection,PublicKey,NONCE_ACCOUNT_LENGTH,VersionedTransaction} from '@solana/web3.js';
import {multiPublicSchema,SOLANA_GENESIS} from './multi-protocol';
import {checkNonceAccount} from './nonce-setup-service';
import {checkSolanaCluster} from './multi-online';
import {solanaEvidence} from './transaction-evidence';
import {nonceAddress,nonceSeed,unsignedNonceBytes} from './nonce-setup-protocol';
import {OFFLINE_NONCE_TTL,offlineNonceSchema,offlineNonceTransaction,offlineNonceFingerprint,validateOfflineNonce,verifyOfflineNonceResponse,type OfflineNonceRequest} from './offline-nonce-protocol';
const wallet=multiPublicSchema;
const schema=z.discriminatedUnion('action',[
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
// Browser durable intent is required; this worker map is a second layer, never a retry queue.
const attempts=new Set<string>();
export async function offlineNonceAction(input:unknown,c:Connection,enabled=false){
 const a=schema.parse(input);await checkSolanaCluster(c);
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
  // Only finalized blockhash expiry plus a missing account permits explicit disposal, never resubmission.
  if(!(await c.isBlockhashValid(r.blockhash,{commitment:'finalized'})).value&&await c.getBlockHeight('finalized')>r.lastValidBlockHeight&&!(await c.getAccountInfo(new PublicKey(r.nonceAccount),'finalized')))return {state:'expired',hash:s.transactionHash,message:'Original blockhash is finalized-expired and no nonce account was found. No settlement is claimed. A new attempt needs fresh offline approval.'};
  return evidence;
 }
 if(a.action==='submit'&&!enabled)throw Error('Offline nonce submission requires verified new-ISO acceptance.');
 await fresh(r,c);await verifyOfflineNonceResponse(s,r,a.wallet);
 const simulation=await c.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(s.rawSignedTransaction,'base64')),{sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed'});
 if(simulation.value.err)throw Error('Exact signed nonce creation simulation failed.');
 await fresh(r,c);await verifyOfflineNonceResponse(s,r,a.wallet);
 if(a.action==='preflight')return {state:'ready',hash:s.transactionHash,enabled};
 if(attempts.has(s.transactionHash))return {state:'unknown',hash:s.transactionHash,message:'Already attempted. Reconcile this exact signature; never automatically retry.'};
 if(attempts.size>=10000)throw Error('Nonce submission capacity reached.');attempts.add(s.transactionHash);
 try{const hash=await c.sendRawTransaction(Buffer.from(s.rawSignedTransaction,'base64'),{skipPreflight:false,maxRetries:0,preflightCommitment:'confirmed'});if(hash!==s.transactionHash)throw Error('Unexpected signature.');return {state:'submitted',hash};}
 catch{return {state:'unknown',hash:s.transactionHash,message:'Submission uncertain. Reconcile this signature; no automatic retry.'};}
}
