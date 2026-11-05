const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const {transformSync}=require('esbuild');
const source=transformSync(fs.readFileSync(path.join(__dirname,'../online/lifi-solana.ts'),'utf8'),{loader:'ts',format:'cjs',target:'node24'}).code;
const {fixture,serialize}=require('./helpers/lifi-solana-fixture.cjs'),core=require('../dist/lifi-solana.cjs');
function setup(failure){
 const f=fixture(),now=Date.now(),r={version:11,action:'swap',provider:'lifi-jupiter',chain:'solana',network:'solana',requestId:randomUUID(),deviceId:randomUUID(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),...f.r,tokenOut:'USDC',accountRent:'6000000',blockhash:f.message.recentBlockhash,lastValidBlockHeight:999999999,lookupTables:f.snapshots,unsignedTransaction:serialize(f)};r.fingerprint=core.lifiSolanaFingerprint(r);
 const state={active:0,maxActive:0,completed:[],height:100,heightReads:0};
 const pause=async name=>{state.active++;state.maxActive=Math.max(state.maxActive,state.active);try{await new Promise(resolve=>setTimeout(resolve,8));if(failure===name)throw Error('injected '+name);state.completed.push(name);}finally{state.active--;}};
 const module={exports:{}},localRequire=x=>{
  if(x==='./adapter')return {};
  if(x==='./providers')return {LifiQuotes:class{}};
  if(x==='./jupiter-shared-accounts')return {verifyJupiterSharedAccounts:async()=>{}};
  if(x==='./solana-programs')return {verifySolanaPrograms:async()=>pause('programs')};
  if(x==='../engine/core/payment-intent')return require('../dist/payment.cjs');
  if(x==='../engine/core/lifi-solana-inspect')return require('../dist/lifi-solana-inspect.cjs');
  if(x==='../engine/core/lifi-solana-intent')return core;
  if(x==='../engine/core/lifi-solana-settlement')return require('../dist/lifi-solana-settlement.cjs');
  if(x==='../vendor/jupiter/idl.json')return require('../vendor/jupiter/idl.json');
  return require(x);
 };
 vm.runInNewContext(source,{module,exports:module.exports,require:localRequire,Buffer,console,Date,setTimeout},{filename:'online/lifi-solana.ts'});
 const adapter={async identity(){await pause('identity');},async balance(){await pause('balance');return{native:'100000000',amount:'100000000'};},async rpc(_c,method){await pause(method);if(method==='isBlockhashValid')return{value:failure!=='invalid-blockhash'};if(method==='getBlockHeight'){state.heightReads++;return failure==='expires-during-work'&&state.heightReads>1?r.lastValidBlockHeight+1:state.height;}if(method==='getEpochInfo')return{epoch:failure==='epoch'?r.epoch+1:r.epoch};if(method==='getFeeForMessage')return{value:failure==='fee'?Number(r.maximumFee)+1:Number(r.maximumFee)};if(method==='simulateTransaction')return{value:{err:failure==='simulation'?{InstructionError:[0,'test']}:null}};throw Error('Unexpected method '+method);}};
 const a=new module.exports.LifiSolanaAdapter(adapter);
 a.lookupTables=async()=>{await pause('lookups');return failure==='lookup-change'?[{...r.lookupTables[0],dataBase64:'changed'}]:r.lookupTables;};
 a.accountState=async()=>{await pause('accounts');return failure==='rent'?BigInt(r.accountRent)+1n:BigInt(r.accountRent);};
 return{a,r,state};
}
test('preflight overlaps independent reads with at most three active checks and drains them',async()=>{const x=setup();await x.a.preflight(x.r);assert.equal(x.state.active,0);assert.equal(x.state.maxActive,3);for(const name of ['identity','lookups','programs','balance','accounts','getFeeForMessage','simulateTransaction'])assert.ok(x.state.completed.includes(name));assert.equal(x.state.heightReads,2);});
for(const failure of ['programs','lookups','balance','accounts','getFeeForMessage','simulateTransaction','lookup-change','invalid-blockhash','epoch','fee','simulation','rent'])test('failed '+failure+' cannot leave successful or unobserved background work',async()=>{const x=setup(failure);await assert.rejects(x.a.preflight(x.r));assert.equal(x.state.active,0);assert.ok(x.state.completed.includes('accounts')||failure==='accounts');assert.ok(x.state.completed.includes('programs')||failure==='programs');});
test('blockhash expiring during independent checks is rejected by the final recheck',async()=>{const x=setup('expires-during-work');await assert.rejects(x.a.preflight(x.r),/blockhash expired/);assert.equal(x.state.heightReads,2);assert.equal(x.state.active,0);});
