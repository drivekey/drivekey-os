'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict'),{Transaction}=require('ethers');
const {admissionFixture}=require('./helpers/product-admission-fixture.cjs'),{verifyProductProofPackage,verifyProductPackageChain,prepareProductChain}=require('../dist/hinkal-product-admission.cjs');
const {HINKAL_ABI}=require('../dist/hinkal.cjs'),{hinkalEvmSwapFingerprint}=require('../dist/hinkal-evm-swap.cjs'),{hinkalSolanaSwapFingerprint}=require('../dist/hinkal-solana-swap.cjs'),{buildHinkalSolanaSwapWire}=require('../dist/hinkal-solana-swap-wire.cjs');
const {parseStrictJSON}=require('../tools/strict-json.cjs');let fixtures;
const fs=require('node:fs/promises'),path=require('node:path'),{admissionController}=require('./helpers/product-admission-controller.cjs');
before(async()=>{fixtures=[await admissionFixture('ethereum'),await admissionFixture('solana')];});
test('fresh Ethereum and Solana proof packages bind the exact exported proof to separately prepared unsigned chain requests',async()=>{
 for(const f of fixtures){const r=f.chainRequest(),checked=await verifyProductPackageChain(f.document,f.wallet,r);assert.equal(checked.productProof.requestFingerprint,f.document.request.fingerprint);assert.equal(checked.productProof.chainFingerprint,r.fingerprint);assert.equal(Object.hasOwn(checked,'rawSignedTransaction'),false);}
});
test('proof admission validates before any adapter call and carries the narrower approved product deadline',async()=>{
 for(const f of fixtures){let calls=0;const prepared=await prepareProductChain(async(chain,input,wallet)=>{calls++;assert.equal(chain,f.document.request.chain);assert.equal(input.productExpiresAt,f.document.request.expiresAt);assert.ok(Date.parse(input.productExpiresAt)<Date.parse(input.seed.expiresAt));assert.deepEqual(wallet,f.wallet);return f.chainRequest();},f.document,f.wallet);assert.equal(calls,1);assert.ok(prepared.request);
  const changed=structuredClone(f.document);changed.result.authorizationHash='0x'+'0'.repeat(64);await assert.rejects(prepareProductChain(async()=>{calls++;throw Error('Must not reach network');},changed,f.wallet));assert.equal(calls,1);}
});
test('Ethereum chain payload cannot substitute proof coordinates after product proof validation',async()=>{
 const f=fixtures[0],r=f.chainRequest(),tx=Transaction.from(r.unsignedTransaction),args=HINKAL_ABI.decodeFunctionData('transact',tx.data).toArray(true);args[0][0]=(BigInt(args[0][0])+1n).toString();tx.data=HINKAL_ABI.encodeFunctionData('transact',args);r.unsignedTransaction=tx.unsignedSerialized;r.fingerprint=hinkalEvmSwapFingerprint(r);await assert.rejects(verifyProductPackageChain(f.document,f.wallet,r),/exported Ethereum proof bytes/);
});
test('adapter callbacks cannot mutate the original verified proof package or selected wallet',async()=>{
 const f=fixtures[0],original=structuredClone(f.document),wallet=structuredClone(f.wallet);
 const result=await prepareProductChain(async(chain,input,w)=>{input.seed.maximumFee='1';w.deviceId=crypto.randomUUID();return f.chainRequest();},f.document,f.wallet);
 assert.ok(result.request);assert.deepEqual(f.document,original);assert.deepEqual(f.wallet,wallet);
});
test('Solana chain payload cannot substitute proof coordinates while keeping approved public signals',async()=>{
 const f=fixtures[1],r=f.chainRequest(),args=structuredClone(f.document.result.proof.solanaArgs);args.proofAArr[31]^=1;r.unsignedTransaction=buildHinkalSolanaSwapWire(r.proofSeed,args).unsignedTransaction;r.fingerprint=hinkalSolanaSwapFingerprint(r);await assert.rejects(verifyProductPackageChain(f.document,f.wallet,r),/exported Solana proof bytes/);
});
test('wrong wallets, response identities and extended chain deadlines fail closed',async()=>{
 for(const f of fixtures){const w={...f.wallet,deviceId:crypto.randomUUID()};await assert.rejects(verifyProductProofPackage(f.document,w));const p=structuredClone(f.document);p.response.requestId=crypto.randomUUID();await assert.rejects(verifyProductProofPackage(p,f.wallet));const r=f.chainRequest();r.expiresAt=r.proofSeed.expiresAt;r.fingerprint=r.version===18?hinkalEvmSwapFingerprint(r):hinkalSolanaSwapFingerprint(r);await assert.rejects(verifyProductPackageChain(f.document,f.wallet,r),/product proof lifetime/);}
});
test('expired packages remain recoverable but cannot prepare another unsigned request',async()=>{
 for(const f of fixtures){const r=f.chainRequest(),later=Date.parse(f.document.request.expiresAt)+1;await assert.rejects(prepareProductChain(async()=>{throw Error('No network');},f.document,f.wallet,later));await verifyProductPackageChain(f.document,f.wallet,r,later,false);}
});
test('strict proof-package JSON rejects duplicate, escaped duplicate, excessive and malformed fields',()=>{
 for(const text of ['{"request":1,"request":2}','{"a":{"fingerprint":1,"finger\\u0070rint":2}}','['.repeat(42)+'0'+']'.repeat(42),'[] trailing','{"a":1,}'])assert.throws(()=>parseStrictJSON(text));
 assert.deepEqual(parseStrictJSON('{"a":[1,{"b":"quote\\\" value"}]}'),{a:[1,{b:'quote" value'}]});assert.throws(()=>parseStrictJSON('"'+'x'.repeat(100)+'"',50));
});
test('native proof admission cancellation, offline mode and wallet changes stop before reading or preparing',async()=>{
 const f=await admissionController(fixtures[0]);f.state.cancel=true;assert.deepEqual(await f.invoke(),{cancelled:true});assert.equal(f.state.onlineCalls,0);f.state.offline=true;await assert.rejects(f.invoke(),/offline companion/);assert.equal(f.state.pickerCalls,1);f.state.offline=false;
 f.c.dialog.showOpenDialog=async()=>{f.state.wallet.deviceId=crypto.randomUUID();return {canceled:false,filePaths:['nonexistent-fixture-file']};};await assert.rejects(f.invoke(),/wallet or window changed/);assert.equal(f.state.onlineCalls,0);assert.equal(f.state.pending,null);
});
test('native importer creates an encrypted immutable proof binding and only exposes a separate chain review',async()=>{
 for(const fixture of fixtures){const f=await admissionController(fixture),r=await f.invoke();assert.equal(r.requiresSeparateChainReview,true);assert.equal(r.reused,false);assert.equal(f.state.onlineCalls,1);assert.equal(r.review.action,'hinkal-swap');assert.equal(Object.hasOwn(r,'response'),false);assert.equal(Object.hasOwn(r,'request'),false);
  const record=(await f.c.transactionStore.list(fixture.wallet.deviceId))[0];assert.equal(record.state,'prepared');assert.equal(record.productProof.requestFingerprint,fixture.document.request.fingerprint);assert.equal(record.response,undefined);await f.ui.verifyRecord(record,fixture.wallet);
  const bytes=await fs.readFile(f.c.transactionStore.file(fixture.wallet.deviceId,record.request.fingerprint));assert.equal(bytes.includes(Buffer.from(fixture.document.response.walletAuthorization)),false);
  const fresh=await admissionController(fixture,f.directory);await fresh.ui.verifyRecord(record,fixture.wallet);assert.equal(fresh.state.onlineCalls,0);}
});
test('reimporting the same unsigned proof reuses its original request after restart without provider preparation',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture),first=await f.invoke(),original=f.state.pending.request;
 const fresh=await admissionController(fixture,f.directory),again=await fresh.invoke();assert.equal(again.reused,true);assert.notEqual(again.token,first.token);assert.equal(fresh.state.onlineCalls,0);assert.deepEqual(fresh.state.pending.request,original);
});
test('an existing signed-state journal rejects proof replay without replacing stored bytes or preparing again',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture);await f.invoke();const record=(await f.c.transactionStore.list(fixture.wallet.deviceId))[0];
 // Storage-state fixture only, deliberately not a blockchain signature.
 const response={version:record.request.version,requestId:record.request.requestId,deviceId:record.request.deviceId,fingerprint:record.request.fingerprint,rawSignedTransaction:'synthetic-state-fixture-only',transactionHash:'synthetic-state-fixture-only'};
 await f.c.transactionStore.put({...record,state:'signed',response});const file=f.c.transactionStore.file(fixture.wallet.deviceId,record.request.fingerprint),bytes=await fs.readFile(file);await assert.rejects(f.invoke(),/signed or submitted/);assert.equal(f.state.onlineCalls,1);assert.deepEqual(await fs.readFile(file),bytes);
});
test('interruption after prepared journal publication preserves the request and restart reuses it',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture),put=f.c.transactionStore.put.bind(f.c.transactionStore);f.c.transactionStore.put=async record=>{const r=await put(record);f.ui.clear();return r;};
 await assert.rejects(f.invoke(),/canceled/);assert.equal(f.state.pending,null);const original=(await f.c.transactionStore.list(fixture.wallet.deviceId))[0];assert.equal(original.state,'prepared');
 const fresh=await admissionController(fixture,f.directory),reused=await fresh.invoke();assert.equal(reused.reused,true);assert.equal(fresh.state.onlineCalls,0);assert.equal(fresh.state.pending.request.fingerprint,original.request.fingerprint);
});
test('invalidation during provider preparation retains proof recovery but creates no chain journal or approval',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture),online=f.c.online;f.c.online=async j=>{const r=await online(j);f.ui.clear();return r;};await assert.rejects(f.invoke(),/canceled/);assert.equal(f.state.pending,null);assert.equal((await f.c.transactionStore.list(fixture.wallet.deviceId)).length,0);assert.equal((await f.c.authorizationStore.list(fixture.wallet.deviceId)).length,1);assert.equal((await f.c.resultStore.list(fixture.wallet.deviceId)).length,1);
});
test('product binding cannot be dropped or changed by transaction updates',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture);await f.invoke();const record=(await f.c.transactionStore.list(fixture.wallet.deviceId))[0],file=f.c.transactionStore.file(fixture.wallet.deviceId,record.request.fingerprint),bytes=await fs.readFile(file);
 await assert.rejects(f.c.transactionStore.put({...record,productProof:undefined}),/binding is immutable/);await assert.rejects(f.c.transactionStore.put({...record,productProof:{...record.productProof,authorizationHash:'0x'+'0'.repeat(64)}}),/binding is immutable/);assert.deepEqual(await fs.readFile(file),bytes);
});
test('missing original result or journal key fails closed and preserves the existing transaction',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture);await f.invoke();const record=(await f.c.transactionStore.list(fixture.wallet.deviceId))[0],resultFile=f.c.resultStore.location(fixture.wallet.deviceId,fixture.document.request.fingerprint.slice(2)),resultBytes=await fs.readFile(resultFile);await fs.unlink(resultFile);await assert.rejects(f.ui.verifyRecord(record,fixture.wallet),/missing or differs/);await fs.writeFile(resultFile,resultBytes,{flag:'wx'});
 const transactionFile=f.c.transactionStore.file(fixture.wallet.deviceId,record.request.fingerprint),bytes=await fs.readFile(transactionFile),keyFile=path.join(f.directory,'journal-key-v1.dpapi'),key=await fs.readFile(keyFile);await fs.unlink(keyFile);const fresh=await admissionController(fixture,f.directory);await assert.rejects(fresh.invoke());assert.deepEqual(await fs.readFile(transactionFile),bytes);await assert.rejects(fs.access(keyFile),{code:'ENOENT'});await fs.writeFile(keyFile,key,{flag:'wx'});await fresh.ui.verifyRecord(record,fixture.wallet);
});
test('another saved request using the same private notes blocks a second preparation',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture),request=fixture.chainRequest();await f.c.transactionStore.put({version:1,request,state:'prepared'});await assert.rejects(f.invoke(),/Private inputs already belong/);assert.equal(f.state.onlineCalls,0);assert.equal((await f.c.authorizationStore.list(fixture.wallet.deviceId)).length,0);
});
test('native importer independently rejects a changed online binding before transaction persistence',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture),online=f.c.online;f.c.online=async j=>{const r=await online(j);r.productProof.authorizationHash='0x'+'0'.repeat(64);return r;};await assert.rejects(f.invoke(),/different binding/);assert.equal(f.state.pending,null);assert.equal((await f.c.transactionStore.list(fixture.wallet.deviceId)).length,0);
});
test('ambiguous or invalid UTF-8 package files and the production gate reject before preparation',async()=>{
 const f=await admissionController(fixtures[0]);await fs.writeFile(f.file,'{"version":28,"version":28}');await assert.rejects(f.invoke(),/duplicate keys/);assert.equal(f.state.onlineCalls,0);await fs.writeFile(f.file,Buffer.from([0xff]));await assert.rejects(f.invoke());assert.equal(f.state.onlineCalls,0);
 const policy=require('../tools/store-payment-policy.cjs');assert.throws(()=>policy.assertIpcChannel('import-product-proof-package'));assert.throws(()=>policy.assertOnlineJob({action:'hinkal-product-proof-prepare',input:fixtures[0].document}));
});
test('cryptographic validation errors never disclose proof authorization bytes to the renderer',async()=>{
 const f=await admissionController(fixtures[0]),document=structuredClone(fixtures[0].document);document.response.walletAuthorization='0x'+'11'.repeat(65);await fs.writeFile(f.file,JSON.stringify(document));
 await assert.rejects(f.invoke(),error=>{assert.match(error.message,/could not be verified/);assert.equal(error.message.includes('1111111111111111'),false);assert.equal(error.message.includes('R8'),false);return true;});assert.equal(f.state.onlineCalls,0);
});
test('pending proof-bound export and signing checks require the unchanged original protected journal',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture);await f.invoke();await f.ui.verifyPending(f.state.pending,fixture.wallet);
 await assert.rejects(f.ui.verifyPending({...f.state.pending,productProof:{...f.state.pending.productProof,authorizationHash:'0x'+'0'.repeat(64)}},fixture.wallet),/differs from its original/);
 const keyFile=path.join(f.directory,'journal-key-v1.dpapi'),key=await fs.readFile(keyFile);await fs.unlink(keyFile);await assert.rejects(f.ui.verifyPending(f.state.pending,fixture.wallet));await assert.rejects(fs.access(keyFile),{code:'ENOENT'});await fs.writeFile(keyFile,key,{flag:'wx'});await f.ui.verifyPending(f.state.pending,fixture.wallet);
});

test('new native imports retain the complete offline envelope in the original journal and export review',async()=>{
 for(const fixture of fixtures){const f=await admissionController(fixture);await f.invoke();const r=f.state.pending.request;assert.equal(r.version,29);assert.deepEqual(r.package,fixture.document);assert.equal(r.expiresAt,fixture.document.request.expiresAt);assert.equal(f.state.pending.review.fingerprint,r.fingerprint);assert.equal(f.state.pending.productProof.chainFingerprint,r.chainRequest.fingerprint);await f.ui.verifyPending(f.state.pending,fixture.wallet);}
});
test('earlier bound plain-chain journals remain recoverable but cannot create another detached offline approval',async()=>{
 const fixture=fixtures[0],f=await admissionController(fixture);await f.invoke();const current=(await f.c.transactionStore.list(fixture.wallet.deviceId))[0],legacy={...current,request:current.request.chainRequest};await f.c.transactionStore.put(legacy);await f.ui.verifyRecord(legacy,fixture.wallet,false);await assert.rejects(f.ui.verifyRecord(legacy,fixture.wallet,true),/lacks the offline product envelope/);assert.equal((await f.c.transactionStore.list(fixture.wallet.deviceId)).length,2);
});
