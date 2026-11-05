'use strict';
// Explicit worker/failure fixtures, encrypted real files, no chain execution.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {SignatureStore}=require('../signature-store.cjs'),{SigningAttempts}=require('../tools/signing-attempts.cjs');
async function fixture(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-attempts-')),key=randomBytes(32);
 const storage={forJournal:purpose=>({seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(purpose));const b=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},unseal:async b=>{const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAAD(Buffer.from(purpose));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}})};
 const transaction=new SignatureStore(path.join(directory,'signatures-v1'),storage.forJournal('signatures')),proof=new SignatureStore(path.join(directory,'proofs-v1'),storage.forJournal('proofs')),primary={'transaction':transaction,'private-proof':proof};
 const restart=()=>new SigningAttempts(directory,storage,primary),attempts=restart(),walletId=randomUUID();let signs=0;
 const request={version:8,deviceId:walletId,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex'),chain:'ethereum',amount:'1'},response={version:8,deviceId:walletId,requestId:request.requestId,fingerprint:request.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:'synthetic-transferable-fixture-only',transactionHash:'0x'+randomBytes(32).toString('hex')};
 const options={walletId,request,authority:'transaction',verify:async(r,q)=>{assert.equal(r.deviceId,q.deviceId);assert.equal(r.requestId,q.requestId);assert.equal(r.fingerprint,q.fingerprint);assert.equal(r.rawSignedTransaction,response.rawSignedTransaction);return structuredClone(r);},sign:async q=>{signs++;assert.deepEqual(q,request);assert.ok(await attempts.attempts.load(walletId,request.fingerprint.slice(2)));return structuredClone(response);}};
 return {directory,storage,primary,transaction,proof,attempts,restart,walletId,request,response,options,signs:()=>signs};
}
const failed=async()=>{throw Error('Injected storage outage');};
test('an encrypted irreversible claim precedes signing and both journals recover the exact original response',async()=>{
 const f=await fixture(),r=await f.attempts.run(f.options);assert.equal(r.reused,false);assert.equal(f.signs(),1);assert.deepEqual(r.response,f.response);
 for(const store of [f.attempts.attempts,f.attempts.results,f.transaction]){const names=await store.candidates(f.walletId,f.request.fingerprint.slice(2));assert.equal(names.length,1);assert.equal((await fs.readFile(names[0])).includes(Buffer.from(f.response.rawSignedTransaction)),false);}
 const reused=await f.restart().run(f.options);assert.equal(reused.reused,true);assert.deepEqual(reused.response,r.response);assert.equal(f.signs(),1);
});
test('worker timeout or death blocks same, different and private-proof signing after restart',async()=>{
 const f=await fixture();await assert.rejects(f.attempts.run({...f.options,sign:async()=>{throw Error('Worker died');}}),/outcome is uncertain/);
 const fresh=f.restart();for(const options of [f.options,{...f.options,request:{...f.request,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex')}},{...f.options,authority:'private-proof',request:{...f.request,version:28,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex')}}])await assert.rejects(fresh.run(options),/outcome is uncertain/);
 assert.equal(f.signs(),0);const rows=await fresh.list(f.walletId,'transaction');assert.equal(rows.length,1);assert.equal(rows[0].uncertain,true);assert.equal(rows[0].response,undefined);
});
test('a result-journal failure still preserves primary recovery without another signature',async()=>{
 const f=await fixture();f.attempts.results.seal=failed;assert.deepEqual((await f.attempts.run(f.options)).response,f.response);assert.deepEqual((await f.restart().run(f.options)).response,f.response);assert.equal(f.signs(),1);
});
test('a primary-journal failure recovers and lists the original fallback response after restart',async()=>{
 const f=await fixture();f.transaction.seal=failed;await f.attempts.run(f.options);assert.equal(await f.transaction.load(f.walletId,f.request.fingerprint.slice(2)),null);
 const fresh=f.restart();assert.deepEqual((await fresh.recover(f.walletId,f.request.fingerprint.slice(2),'transaction',f.options.verify)).response,f.response);assert.deepEqual((await fresh.list(f.walletId,'transaction'))[0].response,f.response);await fresh.run(f.options);assert.equal(f.signs(),1);
});
test('failure of both result journals retains the claim and forbids a new signature',async()=>{
 const f=await fixture();f.transaction.seal=failed;f.attempts.results.seal=failed;await assert.rejects(f.attempts.run(f.options),/outcome is uncertain/);assert.equal(f.signs(),1);await assert.rejects(f.restart().run(f.options),/outcome is uncertain/);assert.equal(f.signs(),1);
});
test('interrupted exclusive result publication preserves temporary ciphertext as exact-byte recovery',async()=>{
 const f=await fixture();f.transaction.seal=failed;f.attempts.results.fs={...fs,link:failed};await f.attempts.run(f.options);
 const names=await fs.readdir(path.join(f.directory,'signing-results-v1',f.walletId));assert.equal(names.length,1);assert.match(names[0],/\.tmp$/);const before=await fs.readFile(path.join(f.directory,'signing-results-v1',f.walletId,names[0]));
 const restored=await f.restart().run(f.options);assert.deepEqual(restored.response,f.response);assert.equal(f.signs(),1);assert.deepEqual(await fs.readFile(path.join(f.directory,'signing-results-v1',f.walletId,names[0])),before);
});
test('partial encrypted result writes remain preserved and fail closed instead of signing again',async()=>{
 const f=await fixture();f.transaction.seal=failed;const originalOpen=fs.open.bind(fs);f.attempts.results.fs={...fs,open:async(...args)=>{const h=await originalOpen(...args);if(args[1]!=='wx')return h;return {writeFile:async bytes=>{await h.writeFile(bytes.subarray(0,16));throw Error('Injected partial write');},sync:()=>h.sync(),close:()=>h.close()};}};
 await assert.rejects(f.attempts.run(f.options),/outcome is uncertain/);const directory=path.join(f.directory,'signing-results-v1',f.walletId),files=await fs.readdir(directory);assert.equal(files.length,1);const before=await fs.readFile(path.join(directory,files[0]));await assert.rejects(f.restart().run(f.options),/damaged/);assert.equal(f.signs(),1);assert.deepEqual(await fs.readFile(path.join(directory,files[0])),before);
});
test('a cancellation before the claim creates no authority or attempt, while cancellation after the claim preserves uncertainty',async()=>{
 const f=await fixture();await assert.rejects(f.attempts.run({...f.options,current:()=>{throw Error('Canceled before claim');}}),/Canceled/);assert.equal((await f.attempts.attempts.list(f.walletId)).length,0);let calls=0;
 await assert.rejects(f.attempts.run({...f.options,current:()=>{if(++calls===2)throw Error('Canceled after claim');}}),/outcome is uncertain/);assert.equal(f.signs(),0);await assert.rejects(f.restart().run(f.options),/outcome is uncertain/);
});
test('two coordinator instances cannot sign different requests for the same profile wallet concurrently',async()=>{
 const f=await fixture();let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),first=f.attempts.run({...f.options,sign:async r=>{entered();await gate;return f.options.sign(r);}});await ready;
 await assert.rejects(f.restart().run({...f.options,request:{...f.request,fingerprint:'0x'+randomBytes(32).toString('hex')}}),/Finish the current/);release();await first;assert.equal(f.signs(),1);
});
test('conflicting primary and fallback responses stop recovery and preserve both records',async()=>{
 const f=await fixture();await f.attempts.run(f.options);const id=f.request.fingerprint.slice(2),file=f.transaction.location(f.walletId,id),changed={version:1,walletId:f.walletId,request:f.request,response:{...f.response,transactionHash:'0x'+'a'.repeat(64)}};await fs.writeFile(file,await f.transaction.seal(JSON.stringify(changed)));const before=await fs.readFile(file);
 await assert.rejects(f.restart().run(f.options),/responses conflict/);assert.equal(f.signs(),1);assert.deepEqual(await fs.readFile(file),before);
});
test('request and worker-result aliases cannot alter the original recovery or verified response',async()=>{
 const f=await fixture(),request=structuredClone(f.request),promise=f.attempts.run({...f.options,request,sign:async q=>{q.amount='999';return structuredClone(f.response);}});request.amount='555';await promise;assert.equal((await f.transaction.load(f.walletId,f.request.fingerprint.slice(2))).request.amount,'1');
 await assert.rejects(f.restart().run({...f.options,verify:async r=>{r.transactionHash='changed';return r;}}),/changed the original/);assert.equal(f.signs(),0);
});
test('legacy primary signatures remain exportable without a new marker or key operation',async()=>{
 const f=await fixture();await f.transaction.save(f.walletId,f.request,f.response);const r=await f.attempts.run(f.options);assert.equal(r.reused,true);assert.equal(f.signs(),0);assert.equal((await f.attempts.attempts.list(f.walletId)).length,0);
});

test('unresolved attempts block explicit submission but original recovered responses remain readable',async()=>{
 const f=await fixture();await f.attempts.attempts.claim(f.walletId,f.request,f.attempts.marker(f.request,'transaction'));await assert.rejects(f.attempts.assertResolved(f.walletId,f.options.verify),/outcome is uncertain/);assert.equal(f.signs(),0);await f.transaction.save(f.walletId,f.request,f.response);await f.attempts.assertResolved(f.walletId,f.options.verify);assert.deepEqual((await f.attempts.recover(f.walletId,f.request.fingerprint.slice(2),'transaction',f.options.verify)).response,f.response);
});

test('insufficient recovery capacity is rejected before creating a marker or invoking the signer',async()=>{
 const f=await fixture(),request={...f.request,unsignedTransaction:'x'.repeat(64000)};await assert.rejects(f.attempts.run({...f.options,request}),/recovery capacity/);assert.equal(f.signs(),0);assert.equal((await f.attempts.attempts.list(f.walletId)).length,0);
});
