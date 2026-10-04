import 'server-only';
import {z} from 'zod';
import {Interface,Transaction,Signature,getAddress,toQuantity} from 'ethers';
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
 const verify=(raw:unknown)=>{const inspected=inspectFixedOrderTerms(husherInspectionIntent(r),raw,Date.now()),c=inspected.context;
  if(c.feeBaseUnits!==t.providerFeeBaseUnits||c.withdrawalFeeBaseUnits!==t.withdrawalFeeBaseUnits||Date.parse(c.depositDeadline)!==Date.parse(t.depositDeadline)||Date.parse(c.rateLockExpiresAt)!==Date.parse(t.rateLockExpiresAt)||Date.parse(c.orderExpiresAt)!==Date.parse(t.orderExpiresAt))throw Error('Provider terms changed after approval.');
  return {...statusSchema.parse(raw),status:inspected.providerStatus};};
 const provider=verify(await read());
 if(provider.hashIn&&!eq(provider.hashIn,s.transactionHash))throw Error('Provider deposit hash differs from the signed transaction.');
 const {deposit}=await husherDepositStatus(input,dependencies.rpc);
 const base={deposit,providerStatus:provider.status,privacyEnabled:false,canResubmit:false,exchangeSettlementVerified:false};
 if(provider.status==='refund')return {...base,state:'refund-unverified',notice:'Provider reports refund. Its documented API does not bind a refund hash and exact net amount; do not mark refunded or resend.'};
 if(provider.status!=='completed'||!provider.hashOut||!provider.hashIn||deposit.state!=='confirmed'||deposit.finality!=='finalized')return {...base,state:'exchange-pending'};
 if(eq(provider.hashOut,s.transactionHash))throw Error('Payout cannot reuse deposit evidence.');
 const payout=await husherPayoutEvidence(r,provider.hashOut,dependencies.rpc);
 const after=verify(await read());if(after.hashIn!==provider.hashIn||after.hashOut!==provider.hashOut||after.status!==provider.status)throw Error('Provider settlement identity changed during verification.');
 if(payout.settlementVerified&&'logIndex' in payout)await dependencies.claimPayout(t.orderId,provider.hashOut,payout.logIndex!);
 return {...base,payout,state:payout.settlementVerified?'exchange-finalized':payout.state,exchangeSettlementVerified:payout.settlementVerified};
}
