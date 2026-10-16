import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {formatUnits,parseUnits,Transaction,getAddress,sha256} from 'ethers';
import type {WalletSubmissionClaim,WalletSubmissionStore} from './wallet-submission-ledger';
import {HusherLedger} from './husher-ledger';
import {husherOrderPlanSchema,husherOrderPlanFingerprint,createHusherStandardOrder} from './husher-create';
import {createHusherOrderOnce} from './husher-order-intent';
import {husherVolumeReservation} from './husher-valuation';
import {inspectHusherAssetAccess,readHusherOrder,readHusherCorrelatedOrders} from './husher-api';
import {prepareHusherDeposit,preflightHusherDeposit,husherDepositStatus} from './husher-deposit-online';
import {validateHusherDeposit,verifyHusherDepositResponse} from './husher-deposit-protocol';
import {multiPublicSchema} from './multi-protocol';
import type {Rpc} from './protocol';
import {checkEthereumIdentities,ethereumIdentitiesFor} from './ethereum-contract-identity';
import {husherOfflineWindowMs,HUSHER_MIN_OFFLINE_WINDOW_MS,HUSHER_MAX_REQUEST_WINDOW_MS} from './husher-timing';
type Dependencies={store:HusherLedger;rpc:Rpc;key:string|undefined;fetcher?:typeof fetch;walletStore?:WalletSubmissionStore};
const uuid=z.string().uuid();
export async function createOwnedHusherOrder(input:unknown,d:Dependencies,accepted:boolean){
 if(!accepted)throw Error('Husher standard exchange has not passed acceptance.');
 const a=z.object({plan:husherOrderPlanSchema,wallet:multiPublicSchema,consent:z.literal(true)}).strict().parse(input),p=a.plan;
 if(getAddress(a.wallet.evmAddress)!==p.refundAddress)throw Error('Refund must match the offline wallet.');
 const fingerprint=husherOrderPlanFingerprint(p),existing=await d.store.read(p.id);
 if(existing){if(existing.fingerprint!==fingerprint)throw Error('Creation intent changed.');return {state:existing.state,orderId:existing.orderId,id:p.id,canRetryCreate:false};}
 await inspectHusherAssetAccess(d.key,d.fetcher);
 const valuation=await husherVolumeReservation(p.maximumSendAmount,d.rpc);
 const intent={version:1 as const,id:p.id,externalUserId:'drivekey-'+p.id,fingerprint,month:new Date().toISOString().slice(0,7),reservationUsdMicros:valuation.usdMicros,state:'unknown' as const,plan:p};
 return {...await createHusherOrderOnce(intent,d.store,()=>createHusherStandardOrder(p,d.key,d.fetcher),accepted),id:p.id};
}
export async function prepareOwnedHusherOrder(input:unknown,d:Dependencies){
 const a=z.object({id:uuid,wallet:multiPublicSchema,measuredOfflineDurationMs:z.number().int().positive().optional()}).strict().parse(input),requiredWindowMs=husherOfflineWindowMs(a.measuredOfflineDurationMs),saved=await d.store.read(a.id),p=saved?.plan;
 if(!saved||!p||husherOrderPlanFingerprint(p)!==saved.fingerprint||getAddress(a.wallet.evmAddress)!==p.refundAddress)throw Error('No matching durable owner intent.');
 const prepared=await d.store.prepared(a.id);if(prepared){const request=validateHusherDeposit(prepared.request,Date.now(),false);if(prepared.wallet.deviceId!==a.wallet.deviceId)throw Error('Prepared request belongs to another wallet profile.');const savedWindow=z.number().int().min(HUSHER_MIN_OFFLINE_WINDOW_MS).lt(HUSHER_MAX_REQUEST_WINDOW_MS).parse(prepared.offlineWindowMs??HUSHER_MIN_OFFLINE_WINDOW_MS);return {request,offlineWindowMs:Math.max(savedWindow,requiredWindowMs),requiredIso:'RC19',privacyEnabled:false};}
 if(!saved.orderId)throw Error('Creation outcome unresolved. Recover the correlation ID; do not recreate.');
 const raw=await readHusherOrder(saved.orderId,d.key,d.fetcher);
 const order=z.object({sendAddress:z.string(),sendAmount:z.string(),receiveAmount:z.string()}).parse(raw);
 if(parseUnits(order.sendAmount,18)>parseUnits(p.maximumSendAmount,18)||parseUnits(order.receiveAmount,6)!==parseUnits(p.exactReceiveAmount,6))throw Error('Provider amounts exceed the saved creation intent.');
 const result=await prepareHusherDeposit({route:'eth-usdc',orderId:saved.orderId,externalUserId:saved.externalUserId,wallet:a.wallet,depositAddress:order.sendAddress,recipient:p.payoutAddress,refundAddress:p.refundAddress,sendAmount:order.sendAmount,exactReceiveAmount:p.exactReceiveAmount,maximumProviderFees:p.maximumProviderFees,requiredWindowMs},d);
 const persisted=await d.store.savePrepared(a.id,{request:result.request,wallet:a.wallet,offlineWindowMs:requiredWindowMs});
 const savedWindow=z.number().int().min(HUSHER_MIN_OFFLINE_WINDOW_MS).lt(HUSHER_MAX_REQUEST_WINDOW_MS).parse(persisted.offlineWindowMs??HUSHER_MIN_OFFLINE_WINDOW_MS);
 return {...result,request:validateHusherDeposit(persisted.request),offlineWindowMs:Math.max(savedWindow,requiredWindowMs)};
}
export async function recoverOwnedHusherCreation(id:string,d:Dependencies){
 uuid.parse(id);const saved=await d.store.read(id),p=saved?.plan;if(!saved||!p)throw Error('No durable creation intent.');
 const page=z.object({orders:z.array(z.unknown()).max(100),pagination:z.object({page:z.literal(1),total:z.number().int(),totalPages:z.number().int()})}).parse(await readHusherCorrelatedOrders(saved.externalUserId,d.key,d.fetcher));
 if(page.orders.length!==1||page.pagination.total!==1||page.pagination.totalPages!==1)return {state:'creation-unresolved',canRetryCreate:false};
 const candidate=z.object({type:z.literal('normal'),orderId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),externalUserId:z.literal(saved.externalUserId),sendToken:z.literal('ETH'),sendNetwork:z.literal('ETH'),sendAmount:z.string(),receiveToken:z.literal('USDC'),receiveNetwork:z.literal('ETH'),receiveAmount:z.string(),receiveAddress:z.string()}).parse(page.orders[0]);
 if(getAddress(candidate.receiveAddress)!==p.payoutAddress||parseUnits(candidate.sendAmount,18)<=0n||parseUnits(candidate.sendAmount,18)>parseUnits(p.maximumSendAmount,18)||parseUnits(candidate.receiveAmount,6)!==parseUnits(p.exactReceiveAmount,6))throw Error('Correlated order differs from creation approval.');
 const order=z.object({id:z.literal(candidate.orderId),fixedRate:z.literal(true),refundAddress:z.string()}).parse(await readHusherOrder(candidate.orderId,d.key,d.fetcher));if(getAddress(order.refundAddress)!==p.refundAddress)throw Error('Refund address differs from creation approval.');
 await d.store.markCreated(id,saved.fingerprint,candidate.orderId);return {state:'created',orderId:candidate.orderId,canRetryCreate:false};
}
const signed=z.object({request:z.unknown(),response:z.unknown(),wallet:z.unknown()}).strict();
// Authenticated route callers only. A signed envelope is an exact lookup proof,
// never authority to reconstruct either journal or to resend a transaction.
export async function recoverOwnedHusherSubmission(input:unknown,d:Dependencies){
 const a=signed.parse(input),now=Date.now(),r=validateHusherDeposit(a.request,now,false),s=verifyHusherDepositResponse(a.response,r,a.wallet,now,false),wallet=multiPublicSchema.parse(a.wallet);
 const id=uuid.parse(r.terms.externalUserId.slice(9)),saved=await d.store.read(id),p=saved?.plan;
 if(!saved||!p||saved.state!=='created'||saved.externalUserId!==r.terms.externalUserId||saved.orderId!==r.terms.orderId||saved.fingerprint!==husherOrderPlanFingerprint(p)||p.refundAddress!==getAddress(r.payment.from)||p.payoutAddress!==getAddress(r.terms.payoutAddress)||parseUnits(p.exactReceiveAmount,6).toString()!==r.terms.exactReceiveBaseUnits||parseUnits(p.maximumProviderFees,6).toString()!==r.terms.maximumProviderFeeBaseUnits||BigInt(r.terms.sendBaseUnits)>parseUnits(p.maximumSendAmount,18))throw Error('Recovery approval does not match the durable creation intent.');
 const prepared=await d.store.prepared(id);
 if(!prepared||!isDeepStrictEqual(prepared.request,r)||!isDeepStrictEqual(prepared.wallet,wallet))throw Error('Recovery approval does not match the saved prepared request.');
 if(!d.walletStore)throw Error('Shared wallet submission storage is required for recovery.');
 const tx=Transaction.from(s.rawSignedTransaction);
 const expected:WalletSubmissionClaim={version:1,kind:'evm',purpose:'transfer',protocolVersion:8,chainId:1,from:tx.from!.toLowerCase(),nonce:tx.nonce,hash:s.transactionHash,fingerprint:r.fingerprint,signedBytesDigest:sha256(s.rawSignedTransaction),expiresAt:r.payment.expiresAt};
 const shared=await d.walletStore.read({family:'evm',chainId:1,hash:s.transactionHash});
 if(shared&&!isDeepStrictEqual(shared,expected))throw Error('Shared submission journal identity differs.');
 const provider=await d.store.submission(r.fingerprint);
 if(provider&&(provider.hash!==s.transactionHash||provider.orderId!==r.terms.orderId||provider.nonceKey!=='1:'+tx.from!.toLowerCase()+':'+tx.nonce||!isDeepStrictEqual(provider.request,r)||!isDeepStrictEqual(provider.response,s)||!isDeepStrictEqual(provider.wallet,wallet)))throw Error('Provider submission journal identity differs.');
 const journalState=shared?(provider?'both':'shared-only'):(provider?'provider-only':'not-claimed');
 // Once durable identities are verified, a chain read failure must not hide the
 // orphan diagnosis. No failed/unverified read is promoted into chain evidence.
 const evidence=shared||provider?await husherDepositStatus({request:r,response:s,wallet},d.rpc).then(result=>({deposit:result.deposit,depositReadFailed:false})).catch(()=>({deposit:{state:'unknown' as const,hash:s.transactionHash,evidenceVerified:false},depositReadFailed:true})):{deposit:null,depositReadFailed:false};
 return {state:'submission-recovery',journalState,hash:s.transactionHash,orderId:r.terms.orderId,...evidence,canResubmit:false,canRetryCreate:false,exchangeSettlementVerified:false,privacyEnabled:false,
  notice:journalState==='shared-only'?'Shared intent exists without a provider submission record. Deposit evidence is read-only; no journal was repaired and no resend is permitted.':'Read-only journal and deposit evidence. Missing transaction evidence never permits a resend; payout requires separate verification.'};
}
export async function preflightOwnedHusherOrder(input:unknown,d:Dependencies){
 const a=signed.parse(input),r=validateHusherDeposit(a.request),s=verifyHusherDepositResponse(a.response,r,a.wallet),id=uuid.parse(r.terms.externalUserId.slice(9)),saved=await d.store.read(id),p=saved?.plan;
 if(!saved||!p||saved.state!=='created'||saved.orderId!==r.terms.orderId||saved.fingerprint!==husherOrderPlanFingerprint(p)||p.refundAddress!==getAddress(r.payment.from)||p.payoutAddress!==getAddress(r.terms.payoutAddress)||parseUnits(p.exactReceiveAmount,6).toString()!==r.terms.exactReceiveBaseUnits||parseUnits(p.maximumProviderFees,6).toString()!==r.terms.maximumProviderFeeBaseUnits||BigInt(r.terms.sendBaseUnits)>parseUnits(p.maximumSendAmount,18))throw Error('Approval does not match the durable creation intent.');
 if(saved.month!==new Date().toISOString().slice(0,7))throw Error('Reconcile the allowance before using a previous-month order.');
 const volume=await husherVolumeReservation(formatUnits(r.terms.sendBaseUnits,18),d.rpc);
 if(BigInt(volume.usdMicros)>BigInt(saved.reservationUsdMicros))throw Error('Current volume exceeds the reserved allowance.');
 const outputIdentity={kind:'payment' as const,tokenIn:'USDC' as const,poolFee:500 as const};
 await checkEthereumIdentities(d.rpc,outputIdentity,ethereumIdentitiesFor(outputIdentity));
 await preflightHusherDeposit({request:a.request,response:a.response,wallet:a.wallet},d);
 return {id,r,s,a,state:'ready' as const};
}
export async function submitOwnedHusherOrder(input:unknown,d:Dependencies,accepted:boolean){
 if(!accepted)throw Error('Husher standard exchange has not passed acceptance.');
 const envelope=z.object({...signed.shape,consent:z.literal(true)}).strict().parse(input),a=signed.parse({request:envelope.request,response:envelope.response,wallet:envelope.wallet});
 // Expired attempts still recover by exact hash; they can never be resubmitted.
 const r=validateHusherDeposit(a.request,Date.now(),false),verified=verifyHusherDepositResponse(a.response,r,a.wallet,Date.now(),false),previous=await d.store.submission(r.fingerprint);
 if(previous){if(previous.hash!==verified.transactionHash)throw Error('Durable submission differs.');return {state:'submission-uncertain',hash:previous.hash,canResubmit:false,notice:'A submission intent already exists. Reconcile the exact hash; never send again.'};}
 if(!d.walletStore)throw Error('Shared wallet submission storage is required before broadcasting.');
 const signedTx=Transaction.from(verified.rawSignedTransaction);
 const shared:WalletSubmissionClaim={version:1,kind:'evm',purpose:'transfer',protocolVersion:8,chainId:1,from:signedTx.from!.toLowerCase(),nonce:signedTx.nonce,hash:verified.transactionHash,fingerprint:r.fingerprint,signedBytesDigest:sha256(verified.rawSignedTransaction),expiresAt:r.payment.expiresAt};
 const identity={family:'evm' as const,chainId:1,hash:shared.hash};
 const priorWalletClaim=await d.walletStore.read(identity);
 if(priorWalletClaim){if(!isDeepStrictEqual(priorWalletClaim,shared))throw Error('Shared submission journal identity differs.');return {state:'submission-uncertain',hash:shared.hash,canResubmit:false};}
 const checked=await preflightOwnedHusherOrder(a,d),tx=Transaction.from(checked.s.rawSignedTransaction);
 const before=await husherDepositStatus({request:a.request,response:a.response,wallet:a.wallet},d.rpc);if(before.deposit.state!=='unknown')return {...before,state:'deposit-already-seen',canResubmit:false};
 const record={version:1 as const,fingerprint:r.fingerprint,orderId:r.terms.orderId,nonceKey:'1:'+r.payment.from.toLowerCase()+':'+tx.nonce,hash:checked.s.transactionHash,request:r,response:checked.s,wallet:multiPublicSchema.parse(a.wallet),state:'submission-uncertain' as const,createdAt:new Date().toISOString()};
 // The common claim coordinates providers. Never release it if the separate
 // provider journal fails or another process wins that provider claim.
 if(!await d.walletStore.claim(shared))return {state:'submission-uncertain',hash:shared.hash,canResubmit:false};
 if(!isDeepStrictEqual(await d.walletStore.read(identity),shared))throw Error('Shared submission intent failed durable verification. Do not resend.');
 const inserted=await d.store.claimSubmission(checked.id,record);
 if(!inserted)return {state:'submission-uncertain',hash:record.hash,canResubmit:false};
 const readBack=await d.store.submission(r.fingerprint);
 if(!isDeepStrictEqual(readBack,record))throw Error('Submission intent failed durable verification. Do not resend.');
 // Fresh provider and exact simulation checks after the durable claim. Any failure leaves
 // the claim in place: a failed response never grants permission for another attempt.
 try{
  await preflightOwnedHusherOrder(a,d);verifyHusherDepositResponse(a.response,r,a.wallet);
  const hash=await d.rpc('eth_sendRawTransaction',[checked.s.rawSignedTransaction]);
  if(hash!==checked.s.transactionHash)throw Error();
  return {state:'submitted',hash,canResubmit:false,settlementVerified:false};
 }catch{return {state:'submission-uncertain',hash:record.hash,canResubmit:false,settlementVerified:false,notice:'Outcome uncertain or final preflight stopped. Recover the exact hash. Never resubmit automatically.'};}
}
