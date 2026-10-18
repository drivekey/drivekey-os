import {NonceAccount,PublicKey,SystemProgram,VersionedTransaction,VersionedMessage,type Connection} from '@solana/web3.js';
import {multiPublicSchema,SOLANA_GENESIS} from './multi-protocol';
import {nonceControlFingerprint,nonceControlMessage,validateNonceControl,verifyNonceControlResponse,type NonceControlRequest} from './solana-nonce-control';
import {solanaEvidence} from './transaction-evidence';
async function nonce(c:Connection,address:string,owner:string,commitment:'confirmed'|'finalized'='confirmed'){
 if(await c.getGenesisHash()!==SOLANA_GENESIS)throw Error('Wrong Solana network.');
 const info=await c.getAccountInfo(new PublicKey(address),commitment);
 if(!info||info.executable||!info.owner.equals(SystemProgram.programId)||info.data.length!==80||info.data.readUInt32LE(0)!==1||info.data.readUInt32LE(4)!==1)throw Error('Initialized current-version nonce required.');
 const n=NonceAccount.fromAccountData(info.data);if(n.authorizedPubkey.toBase58()!==owner||!Number.isSafeInteger(n.feeCalculator.lamportsPerSignature)||n.feeCalculator.lamportsPerSignature<=0)throw Error('Nonce authority or fee invalid.');return n;
}
export async function prepareNonceControl(wallet:unknown,nonceAccount:string,expectedNonceValue:string,targetRequestFingerprint:string,targetSignature:string|null,c:Connection){
 const w=multiPublicSchema.parse(wallet),n=await nonce(c,nonceAccount,w.solanaAddress),now=Date.now();
 if(n.nonce!==expectedNonceValue)throw Error('The original nonce already changed. Reconcile the original transaction before preparing cancellation.');
 const r:NonceControlRequest={version:1,kind:'solana-nonce-invalidate',network:'solana',genesisHash:SOLANA_GENESIS,requestId:crypto.randomUUID(),deviceId:w.deviceId,from:w.solanaAddress,nonceAccount,nonceValue:n.nonce,maximumFee:String(n.feeCalculator.lamportsPerSignature),targetRequestFingerprint,targetSignature,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),unsignedMessage:'',fingerprint:'0x'+'00'.repeat(32)};
 r.unsignedMessage=Buffer.from(nonceControlMessage(r).serialize()).toString('base64');r.fingerprint=nonceControlFingerprint(r);return {state:'prepared',request:validateNonceControl(r),broadcastEnabled:false};
}
export async function preflightNonceControl(request:unknown,response:unknown,wallet:unknown,c:Connection){
 const r=validateNonceControl(request),s=verifyNonceControlResponse(response,r,wallet),n=await nonce(c,r.nonceAccount,r.from);
 if(n.nonce!==r.nonceValue||String(n.feeCalculator.lamportsPerSignature)!==r.maximumFee)throw Error('Nonce already changed. Reconcile the original transaction.');
 const tx=VersionedTransaction.deserialize(Buffer.from(s.rawSignedTransaction,'base64')),fee=await c.getFeeForMessage(tx.message,'confirmed');
 if(fee.value===null||String(fee.value)!==r.maximumFee||await c.getBalance(new PublicKey(r.from),'confirmed')<fee.value)throw Error('Nonce invalidation fee or balance changed.');
 const simulated=await c.simulateTransaction(tx,{sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed'});
 if(simulated.value.err!==null)throw Error('Exact nonce invalidation simulation failed. Reconcile status.');
 const current=await nonce(c,r.nonceAccount,r.from);if(current.nonce!==r.nonceValue||String(current.feeCalculator.lamportsPerSignature)!==r.maximumFee)throw Error('Nonce changed during preflight.');verifyNonceControlResponse(s,r,wallet);
 return {state:'ready',hash:s.transactionHash,broadcastEnabled:false};
}
export async function nonceControlStatus(request:unknown,response:unknown,wallet:unknown,c:Connection){
 const r=validateNonceControl(request,Date.now(),false),s=verifyNonceControlResponse(response,r,wallet,Date.now(),false),result=await solanaEvidence(s.transactionHash,s.rawSignedTransaction,c),current=await nonce(c,r.nonceAccount,r.from,'finalized');
 if(result.state==='confirmed'&&current.nonce===r.nonceValue)return {...result,state:'submitted',transactionState:'confirmed',nonceChanged:false,cancellationVerified:false,originalOutcome:'must-reconcile-separately' as const,message:'Transaction finalized; nonce advancement is not yet verified. Recheck cancellation and the original swap.'};
 return {...result,nonceChanged:current.nonce!==r.nonceValue,cancellationVerified:result.state==='confirmed'&&current.nonce!==r.nonceValue,originalOutcome:'must-reconcile-separately' as const};
}
