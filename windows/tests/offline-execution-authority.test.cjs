'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{Transaction}=require('ethers');
const {worker}=require('./helpers/unfunded-execution-worker.cjs');
const {exactFixturePolicy}=require('./helpers/unfunded-execution-policy.cjs');
const {executeOfflineJob}=require('../dist/worker.cjs');
const {sourceFingerprint}=require('../BUILD-MANIFEST.json');
const {UNISWAP_V3,swapCalldata,swapFingerprint}=require('../dist/swap.cjs');
let vault;const password='Disposable local execution fixture; never fund.';
before(()=>{vault=worker({action:'create',password});});
function request(){const now=Date.now(),r={version:9,action:'swap',provider:'uniswap-v3',chain:'ethereum',network:'ethereum',requestId:randomUUID(),deviceId:vault.public.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from:vault.public.evmAddress,recipient:vault.public.evmAddress,tokenIn:'ETH',tokenOut:'USDC',amount:'100000000000000',quotedOutput:'100000',minimumOutput:'99000',slippageBps:100,poolFee:500,deadline:Math.floor((now+120000)/1000),maximumFee:'60000000000000',routerCodeHash:UNISWAP_V3.routerCodeHash};r.unsignedTransaction=Transaction.from({type:2,chainId:1,nonce:0,to:UNISWAP_V3.router,data:swapCalldata(r),value:r.amount,gasLimit:300000,maxFeePerGas:200000000,maxPriorityFeePerGas:100000000}).unsignedSerialized;r.fingerprint=swapFingerprint(r);return r;}
test('normal compiled CLI rejects every unqualified transaction version and JSON policy injection',()=>{
 for(const version of [9,10,11,12,14,16,18,21,22,23,24,25,26,29])for(const action of ['review','sign']){
  const run=spawnSync(process.execPath,['--no-addons','--require','./tests/offline-network-deny.cjs','dist/worker.cjs'],{input:JSON.stringify({action,request:{version},executionPolicy:{allow:true},policy:{allow:true},testOnly:true}),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024,env:{SystemRoot:process.env.SystemRoot,DRIVEKEY_FULL_PRODUCT:'1',DRIVEKEY_TEST_ONLY:'1'}});
  assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).ok,false);
 }
});
test('unfunded exact authority rejects changed terms, wrong wallet/action, expiry, reuse and all private capabilities',()=>{
 const r=request(),p=exactFixturePolicy(r,vault.public,{sourceFingerprint}),context={action:'review',wallet:vault.public};
 p.assertIntent(structuredClone(r),context);assert.throws(()=>p.assertIntent({...r,amount:'1'},context),/scope/);
 assert.throws(()=>p.assertIntent(r,{...context,wallet:{...vault.public,deviceId:randomUUID()}}),/scope/);
 assert.throws(()=>p.assertIntent(r,{...context,action:'create'}),/scope/);
 p.assertIntent(r,{...context,action:'sign'});assert.throws(()=>p.assertIntent(r,{...context,action:'sign'}),/consumed/);
 assert.throws(()=>exactFixturePolicy(r,vault.public,{sourceFingerprint,now:Date.now()-60001}).assertIntent(r,context),/expired/);
 assert.throws(()=>p.assertPrivateView());assert.throws(()=>p.assertProductProof());
});
test('compiled dispatcher rejects malformed policies and explicit false, true or object authorization results',async()=>{
 const r=request(),job={action:'review',request:r,vault};
 for(const policy of [null,{}, {assertIntent(){}}])await assert.rejects(executeOfflineJob(job,policy),/trusted execution/);
 for(const result of [false,true,{},'allow'])await assert.rejects(executeOfflineJob(job,{assertIntent:()=>result,assertPrivateView(){},assertProductProof(){}}),/did not authorize/);
});
test('compiled dispatcher snapshots the complete job before asynchronous authorization and freezes the policy scope',async()=>{
 const r=request(),job={action:'review',vault:structuredClone(vault),request:structuredClone(r)};
 let release,entered;const pending=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const exact=exactFixturePolicy(r,vault.public,{sourceFingerprint});
 const result=executeOfflineJob(job,{...exact,async assertIntent(value,context){
  assert.ok(Object.isFrozen(value)&&Object.isFrozen(context)&&Object.isFrozen(context.wallet));
  assert.throws(()=>{value.amount='1';},TypeError);entered();await gate;exact.assertIntent(value,context);
 }});
 await pending;job.request.amount='1';job.vault.public.deviceId=randomUUID();release();
 const review=await result;assert.equal(review.spender,UNISWAP_V3.router);
});
test('the fixture worker refuses vaults not freshly enrolled in this harness',()=>{
 assert.throws(()=>worker({action:'sign',vault:{...vault,public:{...vault.public,deviceId:randomUUID()}},password,request:request()}),/fresh fixture vaults/);
});
