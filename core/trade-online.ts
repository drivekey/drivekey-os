import { Interface, Transaction, parseUnits, toQuantity } from 'ethers';
import { z } from 'zod';
import { multiPublicSchema } from './multi-protocol';
import { ETH_TOKENS, QUOTER, SWAP_ROUTER, TOKEN, tradeCall, tradeFingerprint, validateTrade, verifyTradeResponse, type TradeRequest } from './trade-protocol';
import {evmEvidence} from './transaction-evidence';
import {checkEthereumIdentities,ethereumIdentitiesFor} from './ethereum-contract-identity';
import {ethereumDeliveryEvidence} from './ethereum-delivery-evidence';
import type { Rpc } from './protocol';
export const prepareTradeSchema=z.object({wallet:multiPublicSchema,kind:z.enum(['swap','approval','payment']),tokenIn:z.enum(['ETH','WETH','USDC']),amount:z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(78),recipient:z.string().max(64).optional(),slippageBps:z.number().int().min(0).max(100).default(50)}).strict();
const quoter=new Interface(['function quoteExactInputSingle(address,address,uint24,uint256,uint160) returns(uint256)']);
const num=(v:unknown)=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]{1,64}$/.test(v))throw Error('Invalid RPC quantity.');return BigInt(v);};
async function network(rpc:Rpc){if(num(await rpc('eth_chainId'))!==1n)throw Error('Wrong Ethereum network.');}
async function tokenValue(rpc:Rpc,token:string,method:string,args:unknown[]){const raw=await rpc('eth_call',[{to:token,data:TOKEN.encodeFunctionData(method,args)},'pending']);return TOKEN.decodeFunctionResult(method,String(raw))[0] as bigint;}
export async function prepareTrade(input:unknown,rpc:Rpc,now=Date.now()) {
 const a=prepareTradeSchema.parse(input);await network(rpc);
 const amount=parseUnits(a.amount,a.tokenIn==='USDC'?6:18);if(amount<=0n)throw Error('Amount must be positive.');
 const expires=Math.floor((now+30*60_000)/1000)*1000;
 const r:TradeRequest & {version:7}={version:7,contractIdentities:[],network:'ethereum',chainId:1,kind:a.kind,requestId:crypto.randomUUID(),deviceId:a.wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(expires).toISOString(),from:a.wallet.evmAddress,recipient:a.kind==='swap'?a.wallet.evmAddress:a.kind==='approval'?SWAP_ROUTER:a.recipient||'',tokenIn:a.tokenIn,tokenOut:null,amount:amount.toString(),minimumOutput:'0',quotedOutput:'0',slippageBps:0,poolFee:500,unsignedTransaction:'0x00',fingerprint:'0x'+'00'.repeat(32)};
 if(a.kind==='swap') {
  if(a.tokenIn==='ETH')throw Error('Use WETH for this swap release.');
  r.tokenOut=a.tokenIn==='WETH'?'USDC':'WETH';r.slippageBps=a.slippageBps;
  const quotes=await Promise.allSettled(([500,3000] as const).map(async fee=>{const raw=await rpc('eth_call',[{to:QUOTER,data:quoter.encodeFunctionData('quoteExactInputSingle',[ETH_TOKENS[a.tokenIn as 'WETH'|'USDC'].address,ETH_TOKENS[r.tokenOut!].address,fee,amount,0])},'latest']);return {fee,out:quoter.decodeFunctionResult('quoteExactInputSingle',String(raw))[0] as bigint};}));
  const best=quotes.flatMap(q=>q.status==='fulfilled'?[q.value]:[]).sort((a,b)=>a.out>b.out?-1:1)[0];
  if(!best||best.out<=0n)throw Error('No supported pool quote available.');
  r.poolFee=best.fee;r.quotedOutput=best.out.toString();r.minimumOutput=(best.out*BigInt(10000-r.slippageBps)/10000n).toString();
  const allowance=await tokenValue(rpc,ETH_TOKENS[a.tokenIn].address,'allowance',[r.from,SWAP_ROUTER]);
  if(allowance<amount)return {state:'approval-required',message:'Prepare and separately approve an exact-amount token allowance, confirm it on-chain, then obtain a fresh swap quote.',quotedOutput:r.quotedOutput,tokenOut:r.tokenOut};
 }
 r.contractIdentities=ethereumIdentitiesFor(r);await checkEthereumIdentities(rpc,r,r.contractIdentities);
 if(a.tokenIn!=='ETH'&&await tokenValue(rpc,ETH_TOKENS[a.tokenIn].address,'balanceOf',[r.from])<amount)throw Error('Insufficient token balance.');
 const call=tradeCall(r),rpcCall={from:r.from,to:call.to,data:call.data,value:toQuantity(call.value)};
 const [nonce,gas,block,tip,balance]=await Promise.all([rpc('eth_getTransactionCount',[r.from,'pending']),rpc('eth_estimateGas',[rpcCall]),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_maxPriorityFeePerGas'),rpc('eth_getBalance',[r.from,'pending'])]);
 const maxPriorityFeePerGas=num(tip),maxFeePerGas=num((block as {baseFeePerGas:unknown}).baseFeePerGas)*2n+maxPriorityFeePerGas,gasLimit=num(gas)*12n/10n;
 if(num(nonce)>4294967295n)throw Error('Nonce out of range.');
 if(num(balance)<gasLimit*maxFeePerGas+call.value)throw Error('Insufficient ETH for maximum fees.');
 await rpc('eth_call',[rpcCall,'pending']);
 r.unsignedTransaction=Transaction.from({type:2,chainId:1,nonce:Number(num(nonce)),...call,gasLimit,maxFeePerGas,maxPriorityFeePerGas}).unsignedSerialized;r.fingerprint=tradeFingerprint(r);
 return {state:'prepared',request:validateTrade(r,now)};
}
export async function tradeStatus(hash:string,rpc:Rpc,raw:string) {
 await network(rpc);
 const evidence=await evmEvidence(hash,raw,rpc);if(evidence.state!=='confirmed')return evidence;
 const receipt=await rpc('eth_getTransactionReceipt',[hash]) as {transactionHash?:string;blockHash?:string;blockNumber?:string;status?:string;logs?:unknown}|null;
 if(!receipt||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||receipt.blockHash!==evidence.evidenceBlockHash||receipt.blockNumber!==evidence.evidenceBlockNumber||receipt.status!=='0x1')throw Error('Receipt changed during delivery verification. Recheck the exact hash.');
 const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as {hash?:string;timestamp?:unknown}|null;
 if(!block||block.hash!==receipt.blockHash)throw Error('Delivery receipt block is no longer canonical.');
 const timestamp=typeof block.timestamp==='string'&&/^0x[0-9a-fA-F]+$/.test(block.timestamp)?BigInt(block.timestamp):undefined;
 const delivery=ethereumDeliveryEvidence(raw,receipt.logs,timestamp);
 return {...evidence,state:delivery.verified?'confirmed':'submitted',deliveryVerified:delivery.verified,deliveryEvidence:delivery,message:delivery.message};
}
export async function preflightTrade(request:unknown,response:unknown,wallet:unknown,rpc:Rpc) {
 const r=validateTrade(request),s=verifyTradeResponse(response,r,wallet);
 await preflightTradeTransaction(r,s.rawSignedTransaction,rpc);
 return {state:'ready',hash:s.transactionHash};
}
// Simulation only. Each caller must verify its own domain-separated approval first.
// This helper cannot submit and independently binds the signed transaction bytes.
export async function preflightTradeTransaction(request:unknown,raw:string,rpc:Rpc){
 const r=validateTrade(request),tx=Transaction.from(raw);
 if(!tx.signature||tx.from?.toLowerCase()!==r.from.toLowerCase()||tx.unsignedSerialized!==r.unsignedTransaction)throw Error('Signed simulation bytes differ from request.');
 await network(rpc);
 const call=tradeCall(r),rpcCall={from:r.from,to:call.to,data:call.data,value:toQuantity(call.value),gas:toQuantity(tx.gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!)};
 const [nonce,balance,block,gas]=await Promise.all([rpc('eth_getTransactionCount',[r.from,'pending']),rpc('eth_getBalance',[r.from,'pending']),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_estimateGas',[rpcCall])]);
 if(num(nonce)!==BigInt(tx.nonce))throw Error('Nonce changed. Reconcile previous activity.');
 if(num(balance)<tx.gasLimit*tx.maxFeePerGas!+tx.value||num(gas)>tx.gasLimit||num((block as {baseFeePerGas:unknown}).baseFeePerGas)+tx.maxPriorityFeePerGas!>tx.maxFeePerGas!)throw Error('Balance or fee conditions changed. Obtain a fresh approval.');
 if(r.tokenIn!=='ETH'&&await tokenValue(rpc,ETH_TOKENS[r.tokenIn].address,'balanceOf',[r.from])<BigInt(r.amount))throw Error('Insufficient token balance.');
 const result=await rpc('eth_call',[rpcCall,'pending']);
 if(r.kind==='swap') { const decoded=new Interface(['function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns(uint256)']).decodeFunctionResult('exactInputSingle',String(result));if(decoded[0]<BigInt(r.minimumOutput))throw Error('Minimum output no longer available.'); }
 else if(r.tokenIn!=='ETH'&&TOKEN.decodeFunctionResult(r.kind==='approval'?'approve':'transfer',String(result))[0]!==true)throw Error('Token simulation failed.');
 if(r.version===7)await checkEthereumIdentities(rpc,r,r.contractIdentities);
 validateTrade(r); // Recheck expiry after asynchronous RPC work.
 return {state:'ready',hash:tx.hash!};
}
