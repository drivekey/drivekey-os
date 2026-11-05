// Network worker only; direct official V3 router avoids API credentials/Permit2.
import {randomUUID} from 'node:crypto';
import {Transaction,Interface,getAddress,keccak256} from 'ethers';
import {z} from 'zod';
import {OnlineAdapter} from './adapter';
import {CHAINS} from '../engine/core/payment-intent';
import {UNISWAP_V3,SWAP_ROUTER,SWAP_TOKEN,QUOTER,SwapIntent,swapCalldata,swapFingerprint,validateSwap,verifySwapResponse} from '../engine/core/swap-intent';
export class UniswapAdapter{
 constructor(readonly adapter:OnlineAdapter){}
 rpc(method:string,params:any[]){return this.adapter.rpc('ethereum',method,params);}
 async identity(){await this.adapter.identity('ethereum');for(const [address,hash]of [[UNISWAP_V3.router,UNISWAP_V3.routerCodeHash],[UNISWAP_V3.quoter,UNISWAP_V3.quoterCodeHash]])if(keccak256(await this.rpc('eth_getCode',[address,'latest']))!==hash)throw Error('Pinned Uniswap deployment changed.');for(const [name,expected]of [['factory',UNISWAP_V3.factory],['WETH9',UNISWAP_V3.weth]])if(SWAP_ROUTER.decodeFunctionResult(name,await this.rpc('eth_call',[{to:UNISWAP_V3.router,data:SWAP_ROUTER.encodeFunctionData(name)},'latest']))[0]!==expected)throw Error('Router immutable identity mismatch.');}
 async quote(tokenIn:'ETH'|'USDC',amount:string,fee:number){await this.identity();const data=QUOTER.encodeFunctionData('quoteExactInputSingle',[tokenIn==='ETH'?UNISWAP_V3.weth:CHAINS.ethereum.usdc,tokenIn==='ETH'?CHAINS.ethereum.usdc:UNISWAP_V3.weth,fee,amount,0]);const result=QUOTER.decodeFunctionResult('quoteExactInputSingle',await this.rpc('eth_call',[{to:UNISWAP_V3.quoter,data},'latest']))[0];if(result<=0n)throw Error('No positive Uniswap quote.');return result.toString();}
 async prepare(input:unknown,w:any,now=Date.now()){
  const p=z.object({action:z.enum(['swap','approve','revoke']),tokenIn:z.enum(['ETH','USDC']),amount:z.string().regex(/^(0|[1-9][0-9]*)$/).max(38),recipient:z.string(),slippageBps:z.number().int().min(0).max(100),poolFee:z.union([z.literal(500),z.literal(3000),z.literal(10000)])}).strict().parse(input);
  await this.identity();const quotedOutput=p.action==='swap'?await this.quote(p.tokenIn,p.amount,p.poolFee):'0';
  // Round minimum UP, so integer truncation cannot exceed the reviewed slippage.
  const minimumOutput=p.action==='swap'?((BigInt(quotedOutput)*BigInt(10000-p.slippageBps)+9999n)/10000n).toString():'0';
  const r:any={version:9,action:p.action,provider:'uniswap-v3',chain:'ethereum',network:'ethereum',requestId:randomUUID(),deviceId:w.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),from:getAddress(w.evmAddress),recipient:getAddress(p.recipient),tokenIn:p.tokenIn,tokenOut:p.tokenIn==='ETH'?'USDC':'ETH',amount:p.amount,quotedOutput,minimumOutput,slippageBps:p.slippageBps,poolFee:p.poolFee,deadline:Math.floor((now+240000)/1000),routerCodeHash:UNISWAP_V3.routerCodeHash};
  const nonce=Number(BigInt(await this.rpc('eth_getTransactionCount',[r.from,'pending']))),price=BigInt(await this.rpc('eth_gasPrice',[])),call={from:r.from,to:p.action==='swap'?UNISWAP_V3.router:CHAINS.ethereum.usdc,data:swapCalldata(r),value:p.action==='swap'&&p.tokenIn==='ETH'?'0x'+BigInt(p.amount).toString(16):'0x0'};
  const estimate=BigInt(await this.rpc('eth_estimateGas',[call])),gas=(estimate*120n+99n)/100n,maxFee=price*2n,priority=maxFee<1000000000n?maxFee:1000000000n;
  r.maximumFee=(gas*maxFee).toString();r.unsignedTransaction=Transaction.from({type:2,chainId:1,nonce,to:call.to,data:call.data,value:call.value,gasLimit:gas,maxFeePerGas:maxFee,maxPriorityFeePerGas:priority}).unsignedSerialized;r.fingerprint=swapFingerprint(r);validateSwap(r,now);await this.preflight(r);return r as SwapIntent;
 }
 async preflight(input:unknown){const r=validateSwap(input),tx=Transaction.from(r.unsignedTransaction);await this.identity();
  if(BigInt(await this.rpc('eth_getTransactionCount',[r.from,'pending']))!==BigInt(tx.nonce))throw Error('Swap nonce conflict.');
  const b=await this.adapter.balance('ethereum',r.from,r.tokenIn);if(BigInt(b.native)<BigInt(r.maximumFee)+tx.value||(r.action==='swap'&&BigInt(b.amount)<BigInt(r.amount)))throw Error('Insufficient swap funds.');
  const allowance=SWAP_TOKEN.decodeFunctionResult('allowance',await this.rpc('eth_call',[{to:CHAINS.ethereum.usdc,data:SWAP_TOKEN.encodeFunctionData('allowance',[r.from,UNISWAP_V3.router])},'pending']))[0];
  if(r.action==='approve'&&allowance!==0n)throw Error('Revoke existing allowance before a separately reviewed exact approval.');
  if(r.action==='swap'&&r.tokenIn==='USDC'&&allowance!==BigInt(r.amount))throw Error('Swap requires exact-amount allowance.');
  const result=await this.rpc('eth_call',[{from:r.from,to:tx.to,data:tx.data,value:'0x'+tx.value.toString(16),gas:'0x'+tx.gasLimit.toString(16)},'pending']);if(r.action!=='swap'&&SWAP_TOKEN.decodeFunctionResult('approve',result)[0]!==true)throw Error('Approval simulation failed.');
  if(r.action==='swap'){const output=r.tokenIn==='ETH'?SWAP_ROUTER.decodeFunctionResult('exactInputSingle',result)[0]:SWAP_ROUTER.decodeFunctionResult('exactInputSingle',SWAP_ROUTER.decodeFunctionResult('multicall',result)[0][0])[0];if(output<BigInt(r.minimumOutput))throw Error('Swap simulation output below minimum.');}
 }
 async broadcast(r:SwapIntent,s:any){verifySwapResponse(s,r,{deviceId:r.deviceId,evmAddress:r.from});await this.identity();const hash=await this.rpc('eth_sendRawTransaction',[s.rawSignedTransaction]);if(hash!==s.transactionHash)throw Error('Uncertain swap broadcast; reconcile approved hash.');return hash;}
 async reconcile(r:SwapIntent,s:any){
  verifySwapResponse(s,r,{deviceId:r.deviceId,evmAddress:r.from},Date.now(),false);await this.identity();
  const receipt=await this.rpc('eth_getTransactionReceipt',[s.transactionHash]),approved=Transaction.from(s.rawSignedTransaction);
  if(!receipt){const observed=await this.rpc('eth_getTransactionByHash',[s.transactionHash]);if(observed)return {state:'pending'};const nonce=BigInt(await this.rpc('eth_getTransactionCount',[r.from,'latest']));return {state:nonce>BigInt(approved.nonce)?'conflict':'uncertain',reason:'No receipt; do not retry or replace.'};}
  const block=await this.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),finalized=await this.rpc('eth_getBlockByNumber',['finalized',false]);
  if(!block||block.hash!==receipt.blockHash)return {state:'uncertain',reason:'Noncanonical swap receipt.'};
  if(!finalized||BigInt(finalized.number)<BigInt(receipt.blockNumber))return {state:'pending',receipt};
  const actualFee=BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice);if(actualFee>BigInt(r.maximumFee))throw Error('Swap settlement fee exceeds approval.');
  if(BigInt(receipt.status)!==1n)return {state:'failed',receipt,actualFee:actualFee.toString()};
  const tx=await this.rpc('eth_getTransactionByHash',[s.transactionHash]);
  if(!tx||tx.hash!==s.transactionHash||tx.blockHash!==block.hash||getAddress(tx.from)!==r.from||getAddress(tx.to)!==approved.to||tx.input!==approved.data||BigInt(tx.value)!==approved.value||BigInt(tx.nonce)!==BigInt(approved.nonce)||BigInt(tx.chainId)!==1n)throw Error('Observed swap transaction differs from approved bytes.');
  const logs=(receipt.logs||[]).filter((l:any)=>!l.removed&&l.transactionHash===s.transactionHash&&l.blockHash===block.hash);
  const allowance=SWAP_TOKEN.decodeFunctionResult('allowance',await this.rpc('eth_call',[{to:CHAINS.ethereum.usdc,data:SWAP_TOKEN.encodeFunctionData('allowance',[r.from,UNISWAP_V3.router])},receipt.blockNumber]))[0];
  if(r.action!=='swap'){
   const expected=r.action==='approve'?BigInt(r.amount):0n,events=logs.filter((l:any)=>{try{const e=SWAP_TOKEN.parseLog(l);return getAddress(l.address)===CHAINS.ethereum.usdc&&e?.name==='Approval'&&e.args.owner===r.from&&e.args.spender===UNISWAP_V3.router&&e.args.value===expected;}catch{return false;}});
   if(events.length!==1||allowance!==expected)throw Error('Approval settlement mismatch.');return {state:'confirmed',receipt,actualFee:actualFee.toString(),allowance:allowance.toString()};
  }
  const transfers=logs.flatMap((l:any)=>{try{const e=SWAP_TOKEN.parseLog(l);return getAddress(l.address)===CHAINS.ethereum.usdc&&e?.name==='Transfer'?[e]:[];}catch{return [];}});
  let output:bigint;
  if(r.tokenOut==='USDC'){
   const credits=transfers.filter((e:any)=>e.args.to===r.recipient);if(credits.length!==1)throw Error('Swap lacks exact USDC recipient credit.');output=credits[0].args.value;
  }else{
   const withdrawal=new Interface(['event Withdrawal(address indexed src,uint256 wad)']);
   const withdrawals=logs.flatMap((l:any)=>{try{const e=withdrawal.parseLog(l);return getAddress(l.address)===UNISWAP_V3.weth&&e?.name==='Withdrawal'&&e.args.src===UNISWAP_V3.router?[e.args.wad as bigint]:[];}catch{return [];}});
   if(withdrawals.length!==1||allowance!==0n)throw Error('Swap lacks exact unwrap or bounded allowance consumption.');
   const debits=transfers.filter((e:any)=>e.args.from===r.from);if(debits.length!==1||debits[0].args.value!==BigInt(r.amount))throw Error('Swap USDC input settlement mismatch.');
   output=withdrawals[0];const previous='0x'+(BigInt(receipt.blockNumber)-1n).toString(16),before=BigInt(await this.rpc('eth_getBalance',[r.recipient,previous])),after=BigInt(await this.rpc('eth_getBalance',[r.recipient,receipt.blockNumber]));
   if(after-before+(r.recipient===r.from?actualFee:0n)!==output)throw Error('Native destination credit unavailable or contaminated by other block activity.');
  }
  if(output<BigInt(r.minimumOutput))throw Error('Swap destination credit below minimum.');return {state:'confirmed',receipt,actualFee:actualFee.toString(),output:output.toString(),recipient:r.recipient,asset:r.tokenOut,allowance:allowance.toString()};
 }
}
