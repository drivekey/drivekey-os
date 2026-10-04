import 'server-only';
import {z} from 'zod';
import {formatUnits} from 'ethers';
import {validateHusherDeposit,verifyHusherDepositResponse,husherDepositFingerprint,type HusherDepositRequest} from './husher-deposit-protocol';
import {inspectHusherFixedOrder,inspectHusherAssetAccess,inspectHusherCreateRecovery} from './husher-api';
import {husherFixedIntent} from './husher-fixed-terms';
import {multiPublicSchema} from './multi-protocol';
import {ETH_TOKENS,tradeFingerprint} from './trade-protocol';
import {preflightTradeTransaction,tradeStatus,prepareTrade} from './trade-online';
import type {Rpc} from './protocol';

const preparation=husherFixedIntent.extend({route:z.literal('eth-usdc'),wallet:multiPublicSchema,externalUserId:z.string().regex(/^drivekey-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)}).strict();
// Preparation of a previously correlated order only. Does not create an order,
// reserve a monthly budget, export a file, or grant the public execution gate.
export async function prepareHusherDeposit(input:unknown,dependencies:{rpc:Rpc;key:string|undefined;fetcher?:typeof fetch}){
 const a=preparation.parse(input);
 await inspectHusherAssetAccess(dependencies.key,dependencies.fetcher);
 const recovery=await inspectHusherCreateRecovery({route:a.route,amount:a.sendAmount,recipient:a.recipient,externalUserId:a.externalUserId,orderType:'normal'},dependencies.key,dependencies.fetcher);
 if(recovery.state!=='candidate-found'||!('orderId' in recovery)||recovery.orderId!==a.orderId)throw Error('Provider order does not match its saved creation intent. Do not recreate.');
 const intent=husherFixedIntent.parse(Object.fromEntries(Object.keys(husherFixedIntent.shape).map(k=>[k,a[k as keyof typeof a]])));
 const inspected=await inspectHusherFixedOrder(intent,dependencies.key,Date.now(),dependencies.fetcher);
 if(!inspected.reviewWindowAvailable)throw Error('Insufficient provider window for offline review.');
 const prepared=await prepareTrade({wallet:a.wallet,kind:'payment',tokenIn:'ETH',amount:a.sendAmount,recipient:a.depositAddress},dependencies.rpc);
 if(!prepared.request||prepared.request.version!==7)throw Error('No supported provider deposit was prepared.');
 const p=prepared.request,c=inspected.context;
 p.expiresAt=new Date(Math.floor(Math.min(Date.parse(p.expiresAt),Date.parse(c.depositDeadline),Date.parse(c.rateLockExpiresAt),Date.parse(c.orderExpiresAt))/1000)*1000).toISOString();
 p.fingerprint=tradeFingerprint(p);
 const r:HusherDepositRequest={version:8,kind:'provider-deposit',payment:p,terms:{provider:'husher',orderType:'normal',fixedRate:true,privacy:false,orderId:a.orderId,externalUserId:a.externalUserId,network:'ethereum',chainId:1,sendAsset:'ETH',receiveAsset:'USDC',receiveContract:ETH_TOKENS.USDC.address,receiveDecimals:6,
  depositAddress:c.depositAddress,payoutAddress:c.recipient,refundAddress:c.refundAddress,sendBaseUnits:c.sendBaseUnits,exactReceiveBaseUnits:c.receiveBaseUnits,providerFeeBaseUnits:c.feeBaseUnits,withdrawalFeeBaseUnits:c.withdrawalFeeBaseUnits,maximumProviderFeeBaseUnits:c.maximumProviderFeeBaseUnits,
  depositDeadline:new Date(c.depositDeadline).toISOString(),rateLockExpiresAt:new Date(c.rateLockExpiresAt).toISOString(),orderExpiresAt:new Date(c.orderExpiresAt).toISOString()},fingerprint:''};
 r.fingerprint=husherDepositFingerprint(r);validateHusherDeposit(r);
 if(Date.parse(p.expiresAt)-Date.now()<a.requiredWindowMs)throw Error('Provider window elapsed during preparation.');
 return {request:r,requiredIso:'RC19',ordersEnabled:false,submissionEnabled:false,privacyEnabled:false};
}

export function husherInspectionIntent(r:HusherDepositRequest,requiredWindowMs=30000){
 const t=r.terms;return {orderId:t.orderId,route:'eth-usdc' as const,depositAddress:t.depositAddress,recipient:t.payoutAddress,refundAddress:t.refundAddress,
  sendAmount:formatUnits(t.sendBaseUnits,18),exactReceiveAmount:formatUnits(t.exactReceiveBaseUnits,6),maximumProviderFees:formatUnits(t.maximumProviderFeeBaseUnits,6),requiredWindowMs};
}
export async function preflightHusherDeposit(input:{request:unknown;response:unknown;wallet:unknown},dependencies:{rpc:Rpc;key:string|undefined;fetcher?:typeof fetch}){
 const r=validateHusherDeposit(input.request),s=verifyHusherDepositResponse(input.response,r,input.wallet),t=r.terms;
 await inspectHusherAssetAccess(dependencies.key,dependencies.fetcher);
 const read=()=>inspectHusherFixedOrder(husherInspectionIntent(r),dependencies.key,Date.now(),dependencies.fetcher);
 const check=(inspection:Awaited<ReturnType<typeof read>>)=>{
  const c=inspection.context;
  if(!inspection.reviewWindowAvailable||c.feeBaseUnits!==t.providerFeeBaseUnits||c.withdrawalFeeBaseUnits!==t.withdrawalFeeBaseUnits||
   Date.parse(c.depositDeadline)!==Date.parse(t.depositDeadline)||Date.parse(c.rateLockExpiresAt)!==Date.parse(t.rateLockExpiresAt)||Date.parse(c.orderExpiresAt)!==Date.parse(t.orderExpiresAt))throw Error('Provider terms changed or insufficient deposit window. Obtain a fresh approval.');
 };
 check(await read());
 await preflightTradeTransaction(r.payment,s.rawSignedTransaction,dependencies.rpc);
 check(await read()); // Recheck provider commitments after asynchronous chain simulation.
 verifyHusherDepositResponse(s,r,input.wallet);
 return {state:'ready-for-release-checks' as const,hash:s.transactionHash,submissionEnabled:false,privacyEnabled:false,
  notice:'Exact deposit simulated and current provider terms matched. Canonical payout-asset verification, durable order/budget reservation and release acceptance are still required.'};
}
// Existing exact transaction/receipt evidence verifies only the deposit. It never
// promotes provider status or an unrelated payout hash into completed exchange evidence.
export async function husherDepositStatus(input:{request:unknown;response:unknown;wallet:unknown},rpc:Rpc){
 const s=verifyHusherDepositResponse(input.response,input.request,input.wallet,Date.now(),false);
 const deposit=await tradeStatus(s.transactionHash,rpc,s.rawSignedTransaction);
 return {deposit,exchangeSettlementVerified:false,privacyEnabled:false,notice:'Deposit evidence only. Payout and refund require separately correlated on-chain evidence.'};
}
