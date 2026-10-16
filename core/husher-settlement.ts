import 'server-only';
import {z} from 'zod';
import {Interface,Transaction,Signature,getAddress,toQuantity,parseUnits} from 'ethers';
import {validateHusherDeposit,verifyHusherDepositResponse} from './husher-deposit-protocol';
import {husherInspectionIntent,husherDepositStatus} from './husher-deposit-online';
import {inspectFixedOrderTerms} from './husher-fixed-terms';
import {inspectHusherCreateRecovery,readHusherOrder} from './husher-api';
import type {Rpc} from './protocol';
import {checkEthereumIdentities,ethereumIdentitiesFor} from './ethereum-contract-identity';
const digest=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const statusSchema=z.object({id:z.string(),hashIn:digest.nullish(),hashOut:digest.nullish()});
const events=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const q=(v:unknown)=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]{1,64}$/.test(v))throw Error('Invalid chain evidence quantity.');return BigInt(v);};
const eq=(a:unknown,b:string)=>typeof a==='string'&&a.toLowerCase()===b.toLowerCase();

// Provider-selected payout hash is corroborated by a signed chain transaction,
// its receipt, the canonical block, exact USDC credit and finality. Never a privacy proof.
export async function husherPayoutEvidence(request:unknown,hash:string,rpc:Rpc){
 const r=validateHusherDeposit(request,Date.now(),false),t=r.terms;digest.parse(hash);
 const identity={kind:'payment' as const,tokenIn:'USDC' as const,poolFee:500 as const};
 await checkEthereumIdentities(rpc,identity,ethereumIdentitiesFor(identity));
 if(q(await rpc('eth_chainId'))!==1n)throw Error('Wrong payout network.');
 const [raw,rawReceipt]=await Promise.all([rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])]);
 if(!raw||!rawReceipt)return {state:'payout-pending' as const,finality:'unverified',settlementVerified:false,hash};
 const tx=raw as Record<string,unknown>,receipt=rawReceipt as Record<string,unknown>;
 if(!eq(tx.hash,hash)||!eq(receipt.transactionHash,hash)||!eq(tx.blockHash,String(receipt.blockHash))||q(tx.blockNumber)!==q(receipt.blockNumber)||q(tx.transactionIndex)!==q(receipt.transactionIndex)||q(tx.chainId)!==1n)throw Error('Payout transaction and receipt differ.');
 const type=Number(q(tx.type));if(![0,1,2].includes(type)||q(tx.nonce)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Unsupported payout transaction type.');
 const actual=Transaction.from({type,chainId:1,nonce:Number(q(tx.nonce)),to:getAddress(String(tx.to)),data:String(tx.input),value:q(tx.value),gasLimit:q(tx.gas),
  ...(type===2?{maxFeePerGas:q(tx.maxFeePerGas),maxPriorityFeePerGas:q(tx.maxPriorityFeePerGas)}:{gasPrice:q(tx.gasPrice)}),
  ...(type>0?{accessList:tx.accessList as []}:{}),signature:Signature.from({r:String(tx.r),s:String(tx.s),v:Number(q(tx.v))})});
 if(actual.hash?.toLowerCase()!==hash.toLowerCase()||!eq(tx.from,actual.from!))throw Error('Payout hash does not match signed transaction bytes.');
 const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as Record<string,unknown>|null;
 if(!block||!eq(block.hash,String(receipt.blockHash))||q(block.number)!==q(receipt.blockNumber)||q(block.timestamp)*1000n<BigInt(Date.parse(r.payment.createdAt)))throw Error('Payout block is not canonical or predates approval.');
 if(receipt.status==='0x0')return {state:'payout-failed' as const,finality:'unverified',settlementVerified:false,hash};
 if(receipt.status!=='0x1'||!Array.isArray(receipt.logs)||receipt.logs.length>1024)throw Error('Missing successful payout receipt.');
 const matches:Array<{index:number;amount:bigint}>=[];let debit=0n;
 for(const l of receipt.logs){
  if(!l||!eq(l.address,t.receiveContract)||!Array.isArray(l.topics)||!eq(l.topics[0],events.getEvent('Transfer')!.topicHash))continue;
  if(l.removed||l.topics.length!==3||!eq(l.transactionHash,hash)||!eq(l.blockHash,String(receipt.blockHash))||q(l.blockNumber)!==q(receipt.blockNumber)||q(l.transactionIndex)!==q(receipt.transactionIndex))throw Error('Invalid payout event provenance.');
  const parsed=events.parseLog(l);if(!parsed)throw Error('Malformed payout event.');const canonical=events.encodeEventLog('Transfer',[...parsed.args]);
  if(!eq(l.data,canonical.data)||canonical.topics.some((v,i)=>!eq(l.topics[i],v)))throw Error('Noncanonical payout event.');
  if(eq(parsed.args[0],t.payoutAddress))debit+=parsed.args[2];
  if(eq(parsed.args[1],t.payoutAddress)){const index=q(l.logIndex);if(index>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invalid event index.');matches.push({index:Number(index),amount:parsed.args[2]});}
 }
 if(matches.length!==1||debit!==0n||matches[0].amount!==BigInt(t.exactReceiveBaseUnits))throw Error('Payout does not uniquely credit the exact approved USDC amount.');
 const finalized=await rpc('eth_getBlockByNumber',['finalized',false]) as Record<string,unknown>|null;
 const recheck=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as Record<string,unknown>|null;
 if(!recheck||!eq(recheck.hash,String(receipt.blockHash)))throw Error('Payout evidence was reorganized.');
 const final=!!finalized&&q(finalized.number)>=q(receipt.blockNumber);
 return {state:final?'payout-finalized' as const:'payout-confirmed' as const,finality:final?'finalized':'confirmed',settlementVerified:final,hash,logIndex:matches[0].index,amount:t.exactReceiveBaseUnits,recipient:t.payoutAddress,contract:t.receiveContract,blockHash:receipt.blockHash};
}

export async function inspectHusherSettlement(input:{request:unknown;response:unknown;wallet:unknown},dependencies:{rpc:Rpc;key:string|undefined;fetcher?:typeof fetch;claimPayout:(order:string,hash:string,index:number)=>Promise<void>}){
 const r=validateHusherDeposit(input.request,Date.now(),false),s=verifyHusherDepositResponse(input.response,r,input.wallet,Date.now(),false),t=r.terms;
 const correlation=await inspectHusherCreateRecovery({route:'eth-usdc',amount:husherInspectionIntent(r).sendAmount,recipient:t.payoutAddress,externalUserId:t.externalUserId,orderType:'normal'},dependencies.key,dependencies.fetcher);
 if(correlation.state!=='candidate-found'||!('orderId' in correlation)||correlation.orderId!==t.orderId)throw Error('Provider order correlation did not match.');
 const read=()=>readHusherOrder(t.orderId,dependencies.key,dependencies.fetcher);
 const raw=await read();
 // Documented refund responses can omit fees and rate-lock terms. Preserve the
 // correlated report without fabricating missing terms or accepting a refund
 // receipt. This path cannot authorize deposits, payouts, retries or new terms.
 const reported=z.object({id:z.literal(t.orderId),status:z.string()}).parse(raw);
 if(reported.status==='refund'){
  const refund=z.object({id:z.literal(t.orderId),status:z.literal('refund'),provider:z.literal('husher').optional(),hashIn:digest.nullish()}).parse(raw);
  if(refund.hashIn&&!eq(refund.hashIn,s.transactionHash))throw Error('Provider deposit hash differs from the signed transaction.');
  const {deposit}=await husherDepositStatus(input,dependencies.rpc);
  return {deposit,providerStatus:'refund',state:'refund-unverified',privacyEnabled:false,canResubmit:false,exchangeSettlementVerified:false,refundVerified:false,providerTermsVerified:false,
   notice:'Provider reports a refund. Refund transaction, amount and receipt are not verified. Do not resend.'};
 }
 // The official status contract explicitly allows null fees. Recovery may still
 // report the independently observed signed deposit; it cannot verify exchange
 // terms, payout, or authorize another submission with those fees unavailable.
 const nullableFees=z.object({feeAmount:z.unknown().optional(),networkFee:z.unknown().optional()}).parse(raw);
 if(nullableFees.feeAmount===null||nullableFees.networkFee===null){
  const decimal=z.string().max(80).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
  const incomplete=z.object({id:z.literal(t.orderId),provider:z.literal('husher'),fixedRate:z.literal(true),
   status:z.enum(['pending','confirmed','exchanging','withdraw','completed','expired','failed']),
   sendAddress:z.string(),receiveAddress:z.string(),refundAddress:z.string(),sendToken:z.literal('ETH'),receiveToken:z.literal('USDC'),sendNetwork:z.literal('ETH'),receiveNetwork:z.literal('ETH'),
   sendAmount:decimal,receiveAmount:decimal,feeAmount:decimal.nullable(),networkFee:decimal.nullable(),
   depositDeadline:z.string().datetime({offset:true}),rateLockExpiresAt:z.string().datetime({offset:true}),orderExpiresAt:z.string().datetime({offset:true}),
   sendTag:z.string().nullish(),receiveTag:z.string().nullish(),refundTag:z.string().nullish(),hashIn:digest.nullish()}).parse(raw);
  if(getAddress(incomplete.sendAddress)!==getAddress(t.depositAddress)||getAddress(incomplete.receiveAddress)!==getAddress(t.payoutAddress)||getAddress(incomplete.refundAddress)!==getAddress(t.refundAddress)||
   parseUnits(incomplete.sendAmount,18)!==BigInt(t.sendBaseUnits)||parseUnits(incomplete.receiveAmount,6)!==BigInt(t.exactReceiveBaseUnits)||
   [incomplete.sendTag,incomplete.receiveTag,incomplete.refundTag].some(tag=>tag!=null&&tag!=='')||
   Date.parse(incomplete.depositDeadline)!==Date.parse(t.depositDeadline)||Date.parse(incomplete.rateLockExpiresAt)!==Date.parse(t.rateLockExpiresAt)||Date.parse(incomplete.orderExpiresAt)!==Date.parse(t.orderExpiresAt)||
   incomplete.feeAmount!==null&&parseUnits(incomplete.feeAmount,6)!==BigInt(t.providerFeeBaseUnits)||
   incomplete.networkFee!==null&&parseUnits(incomplete.networkFee,6)!==BigInt(t.withdrawalFeeBaseUnits))throw Error('Provider terms changed after approval.');
  if(incomplete.hashIn&&!eq(incomplete.hashIn,s.transactionHash))throw Error('Provider deposit hash differs from the signed transaction.');
  const {deposit}=await husherDepositStatus(input,dependencies.rpc);
  return {deposit,providerStatus:incomplete.status,state:'provider-terms-unavailable',privacyEnabled:false,canResubmit:false,exchangeSettlementVerified:false,providerTermsVerified:false,
   notice:'Provider fees are unavailable. Only the signed deposit was checked. Exchange settlement is unverified; do not resend.'};
 }
 const verify=(raw:unknown)=>{const inspected=inspectFixedOrderTerms(husherInspectionIntent(r),raw,Date.now()),c=inspected.context;
  if(c.feeBaseUnits!==t.providerFeeBaseUnits||c.withdrawalFeeBaseUnits!==t.withdrawalFeeBaseUnits||Date.parse(c.depositDeadline)!==Date.parse(t.depositDeadline)||Date.parse(c.rateLockExpiresAt)!==Date.parse(t.rateLockExpiresAt)||Date.parse(c.orderExpiresAt)!==Date.parse(t.orderExpiresAt))throw Error('Provider terms changed after approval.');
  return {...statusSchema.parse(raw),status:inspected.providerStatus};};
 const provider=verify(raw);
 if(provider.hashIn&&!eq(provider.hashIn,s.transactionHash))throw Error('Provider deposit hash differs from the signed transaction.');
 const {deposit}=await husherDepositStatus(input,dependencies.rpc);
 const base={deposit,providerStatus:provider.status,privacyEnabled:false,canResubmit:false,exchangeSettlementVerified:false};
 if(provider.status!=='completed'||!provider.hashOut||!provider.hashIn||deposit.state!=='confirmed'||deposit.finality!=='finalized')return {...base,state:'exchange-pending'};
 if(eq(provider.hashOut,s.transactionHash))throw Error('Payout cannot reuse deposit evidence.');
 const payout=await husherPayoutEvidence(r,provider.hashOut,dependencies.rpc);
 const after=verify(await read());if(after.hashIn!==provider.hashIn||after.hashOut!==provider.hashOut||after.status!==provider.status)throw Error('Provider settlement identity changed during verification.');
 if(payout.settlementVerified&&'logIndex' in payout){
  // Payout verification performs asynchronous reads. Do not claim the exchange
  // using deposit evidence that disappeared or changed during those reads.
  const latest=await husherDepositStatus(input,dependencies.rpc);
  if(latest.deposit.state!=='confirmed'||latest.deposit.finality!=='finalized'||
   latest.deposit.evidenceBlockHash!==deposit.evidenceBlockHash||latest.deposit.evidenceBlockNumber!==deposit.evidenceBlockNumber)throw Error('Deposit evidence changed during settlement verification.');
  await dependencies.claimPayout(t.orderId,provider.hashOut,payout.logIndex!);
 }
 return {...base,payout,state:payout.settlementVerified?'exchange-finalized':payout.state,exchangeSettlementVerified:payout.settlementVerified};
}
