const {test}=require('node:test'),assert=require('node:assert/strict');
for(const [name,file]of [['swap','hinkal-solana-swap-adapter'],['spend','hinkal-solana-spend-adapter']]){
 const C=Object.values(require('../dist/'+file+'.cjs')).find(x=>typeof x==='function'&&x.prototype?.prepareUnsigned);
 test('normal '+name+' preparation retains mandatory preflight after unsigned construction',async()=>{
  const a=new C({}),request={testRequest:true},calls=[];
  a.prepareUnsigned=async(i,w,n)=>{calls.push(['unsigned',i,w,n]);return request;};
  a.preflight=async r=>{assert.equal(r,request);calls.push(['preflight']);};
  assert.equal(await a.prepare('input','wallet',123),request);
  assert.deepEqual(calls,[['unsigned','input','wallet',123],['preflight']]);
  a.preflight=async()=>{throw Error('failed simulation');};
  await assert.rejects(a.prepare('input','wallet',123),/failed simulation/);
 });
 test('unsigned '+name+' construction still refuses missing proof and signing scope',async()=>{
  const a=new C({});await assert.rejects(a.prepareUnsigned({},{}));
 });
}
