'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,randomBytes,createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const fixtureApi=require('../tools/native-fixture-signing.cjs'),scopeApi=require('../tools/native-offline-scope.cjs'),{checkedCredential}=require('../tools/native-fixture-worker.cjs');
const worker=path.resolve(__dirname,'../dist/worker.cjs'),prover=path.resolve(__dirname,'../dist/product-proof-worker.cjs');
const metadata=()=>({version:2,mode:'unfunded-scoped-offline',profileId:randomUUID(),baseSourceFingerprint:'a'.repeat(64)});
async function fixture(action='sign',workerFile=worker){
 const appData=await fs.mkdtemp(path.join(process.env.LOCALAPPDATA,'DriveKeyNativeScopeUnit-')),p=metadata(),directory=path.join(appData,'DriveKeyAcceptance/UnfundedNativeIntentFixtures',p.profileId);await fs.mkdir(directory,{recursive:true});
 const vault={public:{deviceId:randomUUID(),evmAddress:'0x'+'1'.repeat(40),solanaAddress:'11111111111111111111111111111111'},ciphertext:'synthetic ciphertext'},request={version:9,chain:'ethereum',network:'ethereum',fingerprint:'0x'+'b'.repeat(64),deviceId:vault.public.deviceId,amount:'1',recipient:vault.public.evmAddress,minimumOutput:'1',deadline:10},input={action,vault,...action==='verify'?{}:{request},...['sign','verify','inspect-product-notes','sign-product-proof','authorize-private-view'].includes(action)?{password:{fixtureProfileId:p.profileId}}:{}};
 if(action==='sign')input.fingerprint=request.fingerprint;
 const name=path.basename(workerFile),workerHash=createHash('sha256').update(await fs.readFile(workerFile)).digest('hex'),scope={version:2,kind:'fresh-unfunded-offline-intent-scope',fixtureOnly:true,profileId:p.profileId,sourceFingerprint:p.baseSourceFingerprint,deviceId:vault.public.deviceId,vaultDigest:scopeApi.digest(vault),publicWalletDigest:scopeApi.digest(vault.public),workerHashes:{[name]:workerHash},jobs:[{worker:name,action,jobDigest:scopeApi.jobDigest(name,input)}]},secret={version:2,fixtureOnly:true,profileId:p.profileId,deviceId:vault.public.deviceId,vaultDigest:scope.vaultDigest,password:randomBytes(32).toString('hex')};
 const records=new Map();let decryptions=0;
 async function write(name,value){const token=randomBytes(32);records.set(token.toString('hex'),structuredClone(value));await fs.writeFile(path.join(directory,name),token);}
 await write('scope.dpapi',scope);await write('unlock.dpapi',secret);
 const options={worker:workerFile,localAppData:appData,unprotect:async bytes=>{decryptions++;const record=records.get(bytes.toString('hex'));if(!record)throw Error('Synthetic protected record missing');return Buffer.from(JSON.stringify(record));}};
 return {p,directory,scope,secret,input,envelope:{metadata:p,input},options,write,decryptions:()=>decryptions};
}
test('scoped offline metadata is explicit, rejects mixed modes and never changes normal or legacy policy',()=>{
 const p=metadata(),base=require('../tools/store-payment-policy.cjs');assert.deepEqual(fixtureApi.fixtureFromPackage({drivekeyFixtureSigning:p}),p);
 assert.equal(fixtureApi.fixturePolicy(base,null),base);assert.equal(fixtureApi.fixturePolicy(base,{version:1,mode:'unfunded-local-solana'}),base);
 for(const changed of [{...p,version:1},{...p,mode:'unfunded-local-solana'},{...p,mode:'mainnet'},{...p,allowFunding:true}])assert.throws(()=>fixtureApi.fixtureFromPackage({drivekeyFixtureSigning:changed}));
 assert.throws(()=>fixtureApi.fixtureFromPackage({drivekeyFixtureSigning:p,drivekeyQualification:{}}));
});
test('scoped native channels admit offline proof handoffs while refusing every network, funding and submission channel',()=>{
 const p=metadata(),policy=fixtureApi.fixturePolicy(require('../tools/store-payment-policy.cjs'),p);
 for(const channel of ['import-request','sign-request','verify-backup','import-product-proof','sign-product-proof','prove-product-proof','export-product-proof-result','authorize-private-view'])policy.assertIpcChannel(channel);
 for(const channel of ['create-vault','submit-payment','configure-rpc','prepare-payment','prepare-swap','prepare-lifi-evm','import-product-proof-package','download-note-history','start-public-history','market-snapshot'])assert.throws(()=>policy.assertIpcChannel(channel));
});
test('scoped fixture review retains exact chain families and canonical payment assets without enabling normal releases',()=>{
 const p=metadata(),normal=require('../tools/store-payment-policy.cjs');
 for(const [version,chain]of [[8,'ethereum'],[8,'solana'],[9,'ethereum'],[11,'solana'],[12,'ethereum'],[22,'ethereum'],[23,'solana']]){
  const request={version,chain,network:chain,action:version===8?'payment':'swap',asset:chain==='ethereum'?'ETH':'SOL'};fixtureApi.assertFixtureRequest(request,p);if(version!==8)assert.throws(()=>normal.assertIntent(request));assert.throws(()=>fixtureApi.assertFixtureRequest({...request,network:'devnet'},p));
 }
 // Actual v29 envelopes have no outer network field. Native import previously
 // rejected the valid chain even after genuine proof generation and export.
 for(const chain of ['ethereum','solana']){
  const request={version:29,kind:'drivekey-hinkal-product-chain-request',chain,chainRequest:{chain,network:chain}};
  fixtureApi.assertFixtureRequest(request,p);assert.throws(()=>normal.assertIntent(request));
  for(const chainRequest of [undefined,{chain,network:'devnet'},{chain:chain==='solana'?'ethereum':'solana',network:chain}])assert.throws(()=>fixtureApi.assertFixtureRequest({...request,chainRequest},p));
  assert.throws(()=>fixtureApi.assertFixtureRequest({...request,chainRequest:undefined,network:chain},p));
 }
 for(const request of [{version:8,chain:'ethereum',network:'ethereum',action:'payment',asset:'SOL'},{version:8,chain:'solana',network:'solana',action:'payment',asset:'fake'},{version:9,chain:'solana',network:'solana'},{version:999,chain:'ethereum',network:'ethereum'}])assert.throws(()=>fixtureApi.assertFixtureRequest(request,p));
});
test('only the registered offline signer and prover actions use the protected broker',()=>{
 const p=metadata();for(const action of ['review','sign','verify','inspect-product-notes','sign-product-proof','authorize-private-view'])assert.equal(fixtureApi.fixtureWorkerJob(p,{action,vault:{}},'worker.cjs'),true);
 assert.equal(fixtureApi.fixtureWorkerJob(p,{action:'prove-product-proof',vault:{}},'product-proof-worker.cjs'),true);
 for(const worker of ['online-worker.cjs','provider-proof-worker.cjs','product-view-worker.cjs'])assert.equal(fixtureApi.fixtureWorkerJob(p,{action:'sign',vault:{}},worker),false);
 assert.equal(fixtureApi.fixtureWorkerJob(null,{action:'sign',vault:{}},'worker.cjs'),false);
});
test('scoped credentials require the full vault, complete public wallet, source and exact compiled worker before unlock',async()=>{
 const f=await fixture(),opened=await checkedCredential(f.envelope,f.options);assert.equal(opened.password===f.secret.password,true);assert.equal(f.decryptions(),2);assert.equal(Object.keys(opened).includes('executionPolicy'),false);opened.password=undefined;
 for(const mutate of [s=>s.fixtureOnly=false,s=>s.sourceFingerprint='c'.repeat(64),s=>s.publicWalletDigest='c'.repeat(64),s=>s.workerHashes['worker.cjs']='c'.repeat(64),s=>s.vaultDigest='c'.repeat(64),s=>s.jobs=[]]){const changed=structuredClone(f.scope);mutate(changed);await f.write('scope.dpapi',changed);const before=f.decryptions();await assert.rejects(checkedCredential(f.envelope,f.options));assert.equal(f.decryptions()-before,1);}
});
test('request, recipient, asset, amount, fees, minimums, expiry and additional fields cannot enter a scoped signing job',async()=>{
 const f=await fixture();for(const mutate of [e=>e.input.request.recipient='changed',e=>e.input.request.amount='2',e=>e.input.request.asset='fake',e=>e.input.request.maximumFee='9',e=>e.input.request.minimumOutput='0',e=>e.input.request.deadline=20,e=>e.input.fingerprint='0x'+'c'.repeat(64),e=>e.input.wallet={...e.input.vault.public,extra:'changed'},e=>e.input.vault.public.solanaAddress='changed',e=>e.input.executionPolicy={allow:true}]){const changed=structuredClone(f.envelope);mutate(changed);const before=f.decryptions();await assert.rejects(checkedCredential(changed,f.options));assert.ok(f.decryptions()-before<=1);}
});
test('scoped review uses no vault unlock record and cannot inherit a signing authority',async()=>{
 const f=await fixture('review');await fs.rename(path.join(f.directory,'unlock.dpapi'),path.join(f.directory,'unlock.dpapi.preserved'));const value=await checkedCredential(f.envelope,f.options);assert.equal(value.password,undefined);assert.equal(f.decryptions(),1);
 const changed=structuredClone(f.envelope);changed.input.action='sign';changed.input.password={fixtureProfileId:f.p.profileId};await assert.rejects(checkedCredential(changed,f.options));
});
test('missing, corrupted, linked or wrongly scoped protected credentials preserve originals and fail closed',async()=>{
 for(const kind of ['missing','corrupt','linked','wrong-vault']){const f=await fixture(),file=path.join(f.directory,'unlock.dpapi'),original=await fs.readFile(file);await fs.rename(file,file+'.preserved');if(kind==='corrupt')await fs.writeFile(file,randomBytes(32));if(kind==='linked')await fs.link(file+'.preserved',file);if(kind==='wrong-vault')await f.write('unlock.dpapi',{...f.secret,vaultDigest:'c'.repeat(64)});await assert.rejects(checkedCredential(f.envelope,f.options));assert.deepEqual(await fs.readFile(file+'.preserved'),original);}
});
test('scoped execution authority binds its exact method, request, full wallet and one invocation',()=>{
 const input={action:'sign',vault:{public:{deviceId:randomUUID(),evmAddress:'public',solanaAddress:'other-public'}},request:{version:9,amount:'1'}},policy=scopeApi.executionPolicy(input),context={action:'sign',wallet:input.vault.public};
 assert.throws(()=>policy.assertPrivateView(input.request,context));assert.throws(()=>policy.assertProductProof(input.request,context));assert.throws(()=>policy.assertIntent({...input.request,amount:'2'},context));assert.throws(()=>policy.assertIntent(input.request,{...context,wallet:{...context.wallet,solanaAddress:'different'}}));policy.assertIntent(input.request,context);assert.throws(()=>policy.assertIntent(input.request,context),/consumed/);
});
test('only the prover authorization is dynamic while its full request, vault and artifact path remain exactly scoped',()=>{
 const input={action:'prove-product-proof',vault:{public:{deviceId:randomUUID()}},password:{fixtureProfileId:randomUUID()},request:{version:28,fingerprint:'original'},response:{fingerprint:'original',signedAt:'later'},artifactDirectory:'C:/pinned-artifacts'},hash=scopeApi.jobDigest('product-proof-worker.cjs',input);
 assert.equal(scopeApi.jobDigest('product-proof-worker.cjs',{...input,response:{fingerprint:'original',signedAt:'new native authorization'}}),hash);
 for(const change of [{request:{version:28,fingerprint:'changed'}},{artifactDirectory:'C:/other'},{vault:{public:{deviceId:randomUUID()}}}])assert.notEqual(scopeApi.jobDigest('product-proof-worker.cjs',{...input,...change}),hash);
});
test('normal standalone prover CLI rejects JSON and environment authority injection before cryptographic work',()=>{
 const child=spawnSync(process.execPath,['--no-addons',prover],{input:JSON.stringify({action:'prove-product-proof',vault:{},password:'unfunded unit fixture password',request:{version:28},response:{},artifactDirectory:'C:/none',policy:{allow:true}}),encoding:'utf8',windowsHide:true,timeout:15000,env:{SystemRoot:process.env.SystemRoot,DRIVEKEY_FIXTURE_SIGNING:'1',DRIVEKEY_FULL_PRODUCT:'1'}});assert.equal(child.status,1);assert.equal(JSON.parse(child.stdout).ok,false);
});
test('requiring the original prover creates no stdin reader and rejects non-void authority without retaining the input password',async()=>{
 const before=[process.stdin.listenerCount('data'),process.stdin.listenerCount('end')],{executeProductProofJob}=require('../dist/product-proof-worker.cjs');assert.deepEqual([process.stdin.listenerCount('data'),process.stdin.listenerCount('end')],before);
 for(const result of [false,true,{},'allow']){const job={action:'prove-product-proof',vault:{public:{}},password:'unfunded unit fixture password',request:{},response:{},artifactDirectory:'C:/none'};await assert.rejects(executeProductProofJob(job,{assertProductProof:()=>result}),/did not authorize/);assert.equal(job.password,undefined);}
});
test('the original prover snapshots and freezes asynchronous authority scope before any key or proof operation',async()=>{
 const {executeProductProofJob}=require('../dist/product-proof-worker.cjs'),job={action:'prove-product-proof',vault:{public:{deviceId:'original'}},password:'unfunded unit fixture password',request:{fingerprint:'original'},response:{},artifactDirectory:'C:/none'};
 let entered,release;const seen=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const pending=executeProductProofJob(job,{async assertProductProof(request,context){assert.ok(Object.isFrozen(request)&&Object.isFrozen(context.wallet));entered();await gate;assert.equal(request.fingerprint,'original');assert.equal(context.wallet.deviceId,'original');throw Error('Snapshot inspected before crypto');}});
 await seen;job.request.fingerprint='changed';job.vault.public.deviceId='changed';release();await assert.rejects(pending,/Snapshot inspected before crypto/);assert.equal(job.password,undefined);
});
