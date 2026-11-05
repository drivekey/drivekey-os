const {test}=require('node:test'),assert=require('node:assert/strict');
const {cost,authorizePayment}=require('../tools/acceptance-policy.cjs');
function context(){const now=Date.now(),r={chain:'ethereum',network:'ethereum',deviceId:'test',from:'source',recipient:'recipient',fingerprint:'fingerprint',asset:'ETH',amount:'1000000000000',maximumFee:'1000000000000',accountRent:'0'},identity={source:{deviceId:'test',evmAddress:'source'},recipient:{evmAddress:'recipient'},usdc:{ethereum:'canonical'}};
 const state={sessionId:'session',sourceFingerprint:'sourcehash',operations:[]};
 const manifest={version:1,kind:'disposable-payment-authorization',sessionId:'session',sourceFingerprint:'sourcehash',routeId:'payment-eth',stopConditions:['uncertain-broadcast'],request:r,requestFingerprint:r.fingerprint,minimumOutput:r.amount,slippageBps:0,tokenContract:'native',valuation:{observedAt:now,sources:['https://one.test','https://two.test'],nativeUsdMicros:'4000000000',assetUsdMicros:'4000000000'},simulation:{passed:true,fingerprint:r.fingerprint,observedAt:now},nativeBalance:'100000000000000000',nativeReserve:'1000000000000'};
 return {manifest,state,identity,now};}
const authorize=c=>authorizePayment(c.manifest,c.state,c.identity,r=>r,c.now);
test('payment valuations reject URL aliases of one provider',()=>{
 for(const sources of [['https://same.example/a','https://same.example/b'],['https://SAME.example.','https://same.example:443'],['https://user:secret@one.example','https://two.example']]){
  const c=context();c.manifest.valuation.sources=sources;assert.throws(()=>authorize(c),/independent/);
 }
});
test('worst-case gross debit uses integer ceiling and counts reused proceeds',()=>{
 assert.equal(cost('1','4000000000',18),1n);const c=context(),op=authorize(c);assert.equal(op.reservedUsdMicros,'8000');
 c.state.operations.push({...op,state:'settled',actualUsdMicros:'29969999',fingerprint:'old'});assert.throws(()=>authorize(c),/ceiling/);
});
test('one funded operation, replay and uncertain reservations survive restart',()=>{
 const c=context(),op=authorize(c);c.state.operations=JSON.parse(JSON.stringify([op]));assert.throws(()=>authorize(c),/Duplicate|unresolved/);
 c.state.operations=[{...op,fingerprint:'other',state:'uncertain'}];assert.throws(()=>authorize(c),/unresolved/);
 c.state.operations=[{...op,fingerprint:'other',state:'settled',actualUsdMicros:'4999999'}];assert.throws(()=>authorize(c),/ceiling/);
});
test('stale prices, failed simulation, switched wallet, foreign recipient and missing reserve fail closed',()=>{
 for(const mutate of [c=>c.manifest.valuation.observedAt-=120001,c=>c.manifest.simulation.passed=false,c=>c.manifest.request.from='other',c=>c.manifest.request.recipient='other',c=>c.manifest.nativeReserve='0',c=>c.manifest.tokenContract='bad',c=>c.manifest.valuation.sources[1]=c.manifest.valuation.sources[0],c=>c.manifest.sourceFingerprint='changed']){const c=context();mutate(c);assert.throws(()=>authorize(c));}
});
test('fee, complete route and aggregate ceilings have independent limits',()=>{
 const c=context();c.manifest.request.maximumFee='300000000000000';assert.throws(()=>authorize(c),/ceiling/);
 const d=context();d.manifest.request.amount='2000000000000000';d.manifest.minimumOutput=d.manifest.request.amount;assert.throws(()=>authorize(d),/ceiling/);
 assert.throws(()=>cost('-1','1',18));assert.throws(()=>cost('1','1',19));
});
