const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Wallet,Transaction}=require('ethers');
const {authorizeOperation}=require('../tools/acceptance-policy.cjs'),{validateSwap,UNISWAP_V3,swapCalldata,swapFingerprint}=require('../dist/swap.cjs'),{validateHinkal,HINKAL_PIN}=require('../dist/hinkal.cjs'),{CHAINS}=require('../dist/payment.cjs');
const validators={validateSwap,validateHinkal,uniswapRouter:UNISWAP_V3.router,hinkalContract:HINKAL_PIN.ethereumContract};
function context(action='swap'){
 const now=Date.now(),from=Wallet.createRandom().address,deviceId=randomUUID(),r={version:9,action,provider:'uniswap-v3',chain:'ethereum',network:'ethereum',requestId:randomUUID(),deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),from,recipient:from,tokenIn:'USDC',tokenOut:'ETH',amount:'100000',quotedOutput:action==='swap'?'44000000000000':'0',minimumOutput:action==='swap'?'43560000000000':'0',slippageBps:action==='swap'?100:0,poolFee:500,deadline:Math.floor((now+240000)/1000),maximumFee:'6000000000000',routerCodeHash:UNISWAP_V3.routerCodeHash};
 r.unsignedTransaction=Transaction.from({type:2,chainId:1,nonce:0,to:action==='swap'?UNISWAP_V3.router:CHAINS.ethereum.usdc,data:swapCalldata(r),value:0,gasLimit:300000,maxFeePerGas:20000000,maxPriorityFeePerGas:1000000}).unsignedSerialized;r.fingerprint=swapFingerprint(r);
 const identity={source:{deviceId,evmAddress:from},recipient:{evmAddress:Wallet.createRandom().address},tokenRecipient:{evmAddress:Wallet.createRandom().address},usdc:{ethereum:CHAINS.ethereum.usdc}},state={sessionId:'session',sourceFingerprint:'release',operations:[],permissions:[]},manifest={version:1,kind:'disposable-swap-authorization',sessionId:'session',sourceFingerprint:'release',routeId:'uniswap-cycle',request:r,requestFingerprint:r.fingerprint,source:from,destination:from,chainId:1,contractTarget:Transaction.from(r.unsignedTransaction).to,spender:UNISWAP_V3.router,tokenContract:CHAINS.ethereum.usdc,exactInput:r.amount,minimumOutput:r.minimumOutput,slippageBps:r.slippageBps,nonce:0,deadline:r.expiresAt,maximumFee:r.maximumFee,valuation:{observedAt:now,nativeUsdMicros:'2258000000',assetUsdMicros:'1000000',sources:['https://one.test','https://two.test']},simulation:{passed:true,fingerprint:r.fingerprint,observedAt:now,endpoints:['https://rpc-one.test','https://rpc-two.test']},quoteObservedAt:now,nativeReserve:'100000000000000',nativeBalance:'10000000000000000',stopConditions:['uncertain-broadcast']};
 return {manifest,state,identity,now};
}
const authorize=c=>authorizeOperation(c.manifest,c.state,c.identity,validators,c.now);
test('reviewed swaps and exact approvals reserve worst-case gross debit before signing',()=>{for(const action of ['swap','approve']){const c=context(action),op=authorize(c);assert.equal(op.reservedUsdMicros,'113548');assert.equal(op.permission?.amount,action==='approve'?'100000':undefined);}});
test('changing public summaries, spender, nonce, output, source, wallet or release cannot authorize signing',()=>{
 for(const change of [{destination:Wallet.createRandom().address},{spender:Wallet.createRandom().address},{nonce:1},{minimumOutput:'1'},{exactInput:'1'},{maximumFee:'1'},{sourceFingerprint:'another-release'},{source:Wallet.createRandom().address},{tokenContract:'native'}]){const c=context();Object.assign(c.manifest,change);assert.throws(()=>authorize(c));}
});
test('stale quotes, stale simulation, price failure and insufficient reserve stop before a reservation',()=>{
 for(const mutate of [c=>c.manifest.quoteObservedAt-=60001,c=>c.manifest.simulation.observedAt-=60001,c=>c.manifest.valuation.observedAt-=120001,c=>c.manifest.nativeReserve='1',c=>c.manifest.valuation.sources[1]=c.manifest.valuation.sources[0]]){const c=context();mutate(c);assert.throws(()=>authorize(c));assert.equal(c.state.operations.length,0);}
});
test('pending signed operations and remaining exact allowances prohibit unrelated routes',()=>{
 const c=context();c.state.permissions=[{routeId:'another-route',spender:UNISWAP_V3.router,amount:'100000'}];assert.throws(()=>authorize(c),/allowance/);c.state.permissions[0].routeId='uniswap-cycle';assert.ok(authorize(c));c.state.permissions[0].amount='100001';assert.throws(()=>authorize(c),/allowance/);
 const d=context();d.state.operations.push({...authorize(d),state:'uncertain'});assert.throws(()=>authorize(d),/unresolved/);
});
test('settled reused proceeds remain gross spending under session and route ceilings',()=>{
 const c=context();c.state.operations=[{fingerprint:'prior',routeId:'previous-route',state:'settled',reservedUsdMicros:'29969999',actualUsdMicros:'29969999'}];assert.throws(()=>authorize(c),/ceiling/);
 const d=context();d.state.operations=[{fingerprint:'prior',routeId:'uniswap-cycle',state:'settled',reservedUsdMicros:'4999999',actualUsdMicros:'4999999'}];assert.throws(()=>authorize(d),/ceiling/);
});
