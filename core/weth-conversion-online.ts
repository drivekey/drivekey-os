import {z} from 'zod';
import {Transaction,parseUnits,toQuantity} from 'ethers';
import {multiPublicSchema} from './multi-protocol';
import type {Rpc} from './protocol';
import {checkEthereumIdentities,ethereumIdentitiesFor} from './ethereum-contract-identity';
import {evmEvidence} from './transaction-evidence';
import {WETH_CONVERSION_ABI,wethConversionCall,wethConversionFingerprint,validateWethConversion,verifyWethConversionResponse,type WethConversionRequest} from './weth-conversion-protocol';
const inputSchema=z.object({wallet:multiPublicSchema,action:z.enum(['wrap','unwrap']),amount:z.string().max(40).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)}).strict();
const identityAction={kind:'payment',tokenIn:'WETH',poolFee:500} as const;
// Reuse only the existing single-WETH code identity check, not payment semantics.
const pins=ethereumIdentitiesFor(identityAction);
function num(value:unknown){if(typeof value!=='string'||!/^0x[0-9a-fA-F]{1,64}$/.test(value))throw Error('Invalid Ethereum quantity.');return BigInt(value);}
async function balance(r:WethConversionRequest,rpc:Rpc){
 if(r.action==='unwrap'){
  const raw=await rpc('eth_call',[{to:r.contract,data:WETH_CONVERSION_ABI.encodeFunctionData('balanceOf',[r.from])},'pending']);
  if(typeof raw!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(raw)||WETH_CONVERSION_ABI.decodeFunctionResult('balanceOf',raw)[0]<BigInt(r.amount))throw Error('Insufficient WETH balance.');
 }
}
export async function prepareWethConversion(input:unknown,rpc:Rpc,now=Date.now()){
 const a=inputSchema.parse(input),amount=parseUnits(a.amount,18);
 if(amount<=0n||amount>10n**19n)throw Error('Enter a positive conversion amount up to 10 ETH/WETH.');
 await checkEthereumIdentities(rpc,identityAction,pins);
 const r:WethConversionRequest={version:1,kind:'weth-conversion',action:a.action,network:'ethereum',chainId:1,requestId:crypto.randomUUID(),deviceId:a.wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(Math.floor((now+1800000)/1000)*1000).toISOString(),from:a.wallet.evmAddress,recipient:a.wallet.evmAddress,amount:amount.toString(),contract:pins[0].address as WethConversionRequest['contract'],codeHash:pins[0].codeHash as WethConversionRequest['codeHash'],unsignedTransaction:'0x00',fingerprint:'0x'+'00'.repeat(32)};
 await balance(r,rpc);const call={from:r.from,...wethConversionCall(r)},rpcCall={...call,value:toQuantity(call.value)};
 const [nonce,gas,block,tip,nativeBalance]=await Promise.all([rpc('eth_getTransactionCount',[r.from,'pending']),rpc('eth_estimateGas',[rpcCall]),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_maxPriorityFeePerGas'),rpc('eth_getBalance',[r.from,'pending'])]);
 if(num(nonce)>4294967295n)throw Error('Conversion nonce out of range.');
 const gasLimit=num(gas)*12n/10n,maxPriorityFeePerGas=num(tip),maxFeePerGas=num((block as {baseFeePerGas:unknown}).baseFeePerGas)*2n+maxPriorityFeePerGas;
 if(num(nativeBalance)<call.value+gasLimit*maxFeePerGas)throw Error('Insufficient ETH for conversion plus maximum gas.');
 r.unsignedTransaction=Transaction.from({type:2,chainId:1,to:call.to,value:call.value,data:call.data,nonce:Number(num(nonce)),gasLimit,maxFeePerGas,maxPriorityFeePerGas}).unsignedSerialized;r.fingerprint=wethConversionFingerprint(r);validateWethConversion(r,now);
 await rpc('eth_call',[rpcCall,'pending']);return {request:validateWethConversion(r,now),broadcastEnabled:false,swapCompleted:false};
}
export async function preflightWethConversion(request:unknown,response:unknown,wallet:unknown,rpc:Rpc){
 const r=validateWethConversion(request),s=verifyWethConversionResponse(response,r,wallet),tx=Transaction.from(s.rawSignedTransaction);
 await checkEthereumIdentities(rpc,identityAction,pins);await balance(r,rpc);
 const call={from:r.from,to:tx.to,data:tx.data,value:toQuantity(tx.value),gas:toQuantity(tx.gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!)};
 const [nonce,nativeBalance,gas,block]=await Promise.all([rpc('eth_getTransactionCount',[r.from,'pending']),rpc('eth_getBalance',[r.from,'pending']),rpc('eth_estimateGas',[call]),rpc('eth_getBlockByNumber',['latest',false])]);
 if(num(nonce)!==BigInt(tx.nonce)||num(nativeBalance)<tx.value+tx.gasLimit*tx.maxFeePerGas!||num(gas)>tx.gasLimit||num((block as {baseFeePerGas:unknown}).baseFeePerGas)+tx.maxPriorityFeePerGas!>tx.maxFeePerGas!)throw Error('Conversion balance, nonce or fees changed.');
 await rpc('eth_call',[call,'pending']);validateWethConversion(r);return {state:'ready',hash:s.transactionHash,broadcastEnabled:false,swapCompleted:false};
}
export async function wethConversionStatus(request:unknown,response:unknown,wallet:unknown,rpc:Rpc){
 const r=validateWethConversion(request,Date.now(),false),s=verifyWethConversionResponse(response,r,wallet,Date.now(),false);
 await checkEthereumIdentities(rpc,identityAction,pins);
 const evidence=await evmEvidence(s.transactionHash,s.rawSignedTransaction,rpc);
 if(evidence.state!=='confirmed')return {...evidence,conversionVerified:false,swapCompleted:false};
 const receipt=await rpc('eth_getTransactionReceipt',[s.transactionHash]) as any;
 if(!receipt||receipt.transactionHash?.toLowerCase()!==s.transactionHash||receipt.blockHash!==evidence.evidenceBlockHash||receipt.blockNumber!==evidence.evidenceBlockNumber||receipt.status!=='0x1'||!Array.isArray(receipt.logs)||receipt.logs.length>128)throw Error('Conversion receipt changed or is malformed.');
 const event=WETH_CONVERSION_ABI.getEvent(r.action==='wrap'?'Deposit':'Withdrawal')!,matching=[];
 for(const log of receipt.logs){
  if(typeof log.address!=='string'||log.address.toLowerCase()!==r.contract.toLowerCase()||!Array.isArray(log.topics)||log.topics[0]!==event.topicHash)continue;
  if(log.removed||log.transactionHash?.toLowerCase()!==s.transactionHash||log.blockHash!==receipt.blockHash||log.blockNumber!==receipt.blockNumber)throw Error('Invalid conversion event provenance.');
  const parsed=WETH_CONVERSION_ABI.parseLog(log);if(!parsed)throw Error('Malformed conversion event');
  const canonical=WETH_CONVERSION_ABI.encodeEventLog(event,[...parsed.args]);
  if(log.data!==canonical.data||log.topics.length!==canonical.topics.length||log.topics.some((v:string,i:number)=>v!==canonical.topics[i])||String(parsed.args[0]).toLowerCase()!==r.from.toLowerCase()||parsed.args[1]!==BigInt(r.amount))throw Error('Conversion event differs from approved self amount.');matching.push(log);
 }
 if(matching.length!==1)throw Error('No unique exact conversion event.');
 const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false])as any;if(block?.hash!==receipt.blockHash)throw Error('Conversion block changed.');
 return {...evidence,conversionVerified:true,swapCompleted:false,action:r.action,convertedBaseUnits:r.amount,recipient:r.recipient,message:'Exact self conversion finalized. No allowance or swap was executed.'};
}
