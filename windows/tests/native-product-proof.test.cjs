'use strict';
// Controller fixtures use explicit dialog answers. They are not real native
// handoff, separate-device, proof-generation, settlement or live qualification.
const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {SigningAttempts}=require('../tools/signing-attempts.cjs');
const {productProofFixture}=require('../dist/hinkal-product-proof-fixture.cjs'),{reviewProductProof,authorizeProductProof}=require('../dist/hinkal-product-proof-signer.cjs'),{verifyProductProofResponse}=require('../dist/hinkal-product-proof.cjs');
const {installProductProofUi}=require('../tools/native-product-proof.cjs'),{SignatureStore}=require('../signature-store.cjs'),{TransactionStore}=require('../transaction-store.cjs'),{createRecoveryStorage}=require('../tools/recovery-storage.cjs');
let fixture;
before(async()=>{fixture=await productProofFixture();});
async function controller(profile){
 const directory=profile||await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-product-proof-')),storage=createRecoveryStorage(directory,{}),handlers=new Map(),window={isDestroyed:()=>false};
 const state={vault:fixture.vault,wallet:fixture.vault.public,backup:true,approval:1,signs:0,exports:0,dialogCalls:0},calls=[];
 const c={register:(name,handler)=>handlers.set(name,handler),getWindow:()=>window,getVault:()=>state.vault,getPublic:()=>state.wallet,
  backupVerified:()=>state.backup,passwordOf:p=>{assert.equal(p,fixture.password);return p;},ready:()=>storage.ready(),clearOtherReview:()=>{},
  policy:{assertProductProof:()=>{}},openJSON:async()=>({data:structuredClone(fixture.request)}),saveJSON:async()=>{state.exports++;return null;},
  dialog:{showMessageBox:async()=>{state.dialogCalls++;return {response:state.approval};}},
  requestStore:new TransactionStore(path.join(directory,'proof-requests-v1'),storage.forJournal('proof-requests')),
  authorizationStore:new SignatureStore(path.join(directory,'proofs-v1'),storage.forJournal('proofs')),
  resultStore:new SignatureStore(path.join(directory,'proof-results-v1'),storage.forJournal('proof-results')),
  artifactDirectory:()=>path.join(directory,'pinned-prover-fixture'),
  job:async job=>{calls.push(job.action);if(job.action==='review-product-proof')return reviewProductProof(job.request,job.vault);
   if(job.action==='verify')return {verified:true};
   if(job.action==='verify-product-proof'){reviewProductProof(job.request,job.vault,Date.now(),false);return {response:await verifyProductProofResponse(job.request,job.response,Date.now(),false)};}
   if(job.action==='sign-product-proof'){state.signs++;return authorizeProductProof(job.vault,job.password,job.request,job.fingerprint);}
   throw Error('Unexpected fixture worker action');}
 };
 c.signingAttempts=new SigningAttempts(directory,storage,{'private-proof':c.authorizationStore});
 const ui=installProductProofUi(c),invoke=(name,p)=>handlers.get(name)(p);
 return {directory,c,state,calls,ui,invoke};
}
test('native proof controller refuses missing backups, consumes cancellation and never signs on canceled approval',async()=>{
 const f=await controller(),r=await f.invoke('import-product-proof'),p={token:r.token,fingerprint:r.review.fingerprint,password:fixture.password};
 f.state.backup=false;await assert.rejects(f.invoke('sign-product-proof',p),/backup/);assert.equal(f.state.dialogCalls,0);
 f.state.backup=true;f.state.approval=0;assert.deepEqual(await f.invoke('sign-product-proof',p),{cancelled:true,reviewConsumed:true});
 assert.equal(f.state.signs,0);await assert.rejects(f.invoke('sign-product-proof',p),/expired or changed/);assert.equal(f.state.exports,0);
});
test('native proof authorization is encrypted before canceled export and restart exports the same bytes without signing again',async()=>{
 const f=await controller(),r=await f.invoke('import-product-proof'),p={token:r.token,fingerprint:r.review.fingerprint,password:fixture.password};
 const signed=await f.invoke('sign-product-proof',p);assert.equal(signed.kind,'private-proof');assert.equal(signed.saved,false);assert.equal(signed.recoverable,true);assert.equal(f.state.signs,1);
 const original=await f.c.authorizationStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2));assert.ok(original);
 const bytes=await fs.readFile(f.c.authorizationStore.location(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2)));
 assert.equal(bytes.includes(Buffer.from(original.response.walletAuthorization)),false);assert.equal(bytes.includes(Buffer.from(fixture.password)),false);
 const fresh=await controller(f.directory),rows=await fresh.invoke('list-product-proofs');assert.equal(rows.length,1);assert.equal(rows[0].state,'authorized');assert.equal(JSON.stringify(rows).includes('walletAuthorization'),false);
 await fresh.invoke('export-product-proof',{id:fixture.request.fingerprint});assert.equal(fresh.state.signs,0);
 const reviewed=await fresh.invoke('review-product-proof',{id:fixture.request.fingerprint});await fresh.invoke('sign-product-proof',{token:reviewed.token,fingerprint:reviewed.review.fingerprint,password:fixture.password});assert.equal(fresh.state.signs,0);
 const saved=await fresh.c.authorizationStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2));assert.deepEqual(saved.response,original.response);
});
test('wallet changes and invalidated native proof reviews stop before creating authority',async()=>{
 const f=await controller(),r=await f.invoke('import-product-proof');f.ui.clear();await assert.rejects(f.invoke('sign-product-proof',{token:r.token,fingerprint:r.review.fingerprint,password:fixture.password}),/expired or changed/);
 const next=await f.invoke('import-product-proof');f.state.vault=structuredClone(f.state.vault);f.state.vault.public.deviceId=randomUUID();
 await assert.rejects(f.invoke('sign-product-proof',{token:next.token,fingerprint:next.review.fingerprint,password:fixture.password}),/expired or changed/);assert.equal(f.state.signs,0);
});
test('product proof journals participate in lost-key preservation and the shipped feature gate remains closed',async()=>{
 const f=await controller();await f.invoke('import-product-proof');const keyFile=path.join(f.directory,'journal-key-v1.dpapi'),key=await fs.readFile(keyFile);await fs.unlink(keyFile);
 await assert.rejects(createRecoveryStorage(f.directory,{}).ready(),/journal key is missing/);await assert.rejects(fs.stat(keyFile),{code:'ENOENT'});await fs.writeFile(keyFile,key,{flag:'wx'});
 const policy=require('../tools/store-payment-policy.cjs');assert.throws(()=>policy.assertProductProof(fixture.request));
 for(const channel of ['import-product-proof','review-product-proof','sign-product-proof','export-product-proof'])assert.throws(()=>policy.assertIpcChannel(channel));
});

test('invalidation during native approval prevents authorization even when the old dialog approves',async()=>{
 const f=await controller(),r=await f.invoke('import-product-proof');
 f.c.dialog.showMessageBox=async()=>{f.ui.clear();return {response:1};};
 await assert.rejects(f.invoke('sign-product-proof',{token:r.token,fingerprint:r.review.fingerprint,password:fixture.password}),/canceled/);
 assert.equal(f.state.signs,0);assert.equal(f.state.exports,0);
});

test('invalidation during proof creation preserves the original encrypted authority without exporting',async()=>{
 const f=await controller(),r=await f.invoke('import-product-proof'),job=f.c.job;
 f.c.job=async p=>{const result=await job(p);if(p.action==='sign-product-proof')f.ui.clear();return result;};
 await assert.rejects(f.invoke('sign-product-proof',{token:r.token,fingerprint:r.review.fingerprint,password:fixture.password}),/canceled/);
 assert.equal(f.state.signs,1);assert.equal(f.state.exports,0);
 const saved=await f.c.authorizationStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2));
 assert.ok(saved);await verifyProductProofResponse(saved.request,saved.response);
 const fresh=await controller(f.directory);await fresh.invoke('export-product-proof',{id:fixture.request.fingerprint});assert.equal(fresh.state.signs,0);
});

let completedProof;
function attachProver(f,{invalidate=false}={}){
 const job=f.c.job;
 f.c.artifactDirectory=()=>process.env.DRIVEKEY_HINKAL_ARTIFACTS;
 f.c.job=async p=>{
  if(p.action==='verify-product-proof-result')return {result:await require('../dist/hinkal-product-result.cjs').verifyProductProofResult(p.request,p.response,p.result,Date.now(),false)};
  if(p.action==='prove-product-proof'){
   const result=invalidate?completedProof.result:await require('../dist/hinkal-product-prover.cjs').proveProductProof(p.vault,p.password,p.request,p.response,p.artifactDirectory);
   if(invalidate)f.ui.clear();return result;
  }
  return job(p);
 };
}
test('native controller durably saves a genuine proof and restart exports the same result without proving again',async()=>{
 const f=await controller();attachProver(f);const reviewed=await f.invoke('import-product-proof');await f.invoke('sign-product-proof',{token:reviewed.token,fingerprint:reviewed.review.fingerprint,password:fixture.password});
 const answer=await f.invoke('prove-product-proof',{id:fixture.request.fingerprint,password:fixture.password});assert.equal(answer.proved,true);assert.equal(answer.requiresSeparateChainReview,true);
 const record=await f.c.resultStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2)),auth=await f.c.authorizationStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2));completedProof={result:record.response,auth:auth.response};
 const ciphertext=await fs.readFile(f.c.resultStore.location(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2)));assert.equal(ciphertext.includes(Buffer.from(record.response.proof.data)),false);
 const fresh=await controller(f.directory);attachProver(fresh);const rows=await fresh.invoke('list-product-proofs');assert.equal(rows[0].state,'proved');assert.equal(JSON.stringify(rows).includes('proofAArr'),false);assert.equal(JSON.stringify(rows).includes(record.response.proof.data),false);
 fresh.c.job=async p=>{if(p.action==='prove-product-proof')throw Error('Must not prove again');return f.c.job(p);};
 const exported=await fresh.invoke('export-product-proof-result',{id:fixture.request.fingerprint});assert.equal(exported.saved,false);
 const reused=await fresh.invoke('prove-product-proof',{id:fixture.request.fingerprint,password:fixture.password});assert.equal(reused.reused,true);
 assert.deepEqual((await fresh.c.resultStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2))).response,record.response);
});
test('canceled proving does not run, while invalidation after proving preserves the encrypted result',async()=>{
 const f=await controller();attachProver(f,{invalidate:true});await f.c.authorizationStore.save(fixture.vault.public.deviceId,fixture.request,completedProof.auth);
 f.state.backup=false;await assert.rejects(f.invoke('prove-product-proof',{id:fixture.request.fingerprint,password:fixture.password}),/backup/);assert.equal(f.state.dialogCalls,0);f.state.backup=true;
 f.state.approval=0;assert.deepEqual(await f.invoke('prove-product-proof',{id:fixture.request.fingerprint,password:fixture.password}),{cancelled:true});assert.equal(await f.c.resultStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2)),null);
 f.state.approval=1;await assert.rejects(f.invoke('prove-product-proof',{id:fixture.request.fingerprint,password:fixture.password}),/canceled/);assert.equal(f.state.exports,0);assert.deepEqual((await f.c.resultStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2))).response,completedProof.result);
});

test('private-proof fallback authorization remains recoverable after a primary write outage with no new authorization',async()=>{
 const f=await controller();f.c.authorizationStore.seal=async()=>{throw Error('Injected primary proof outage');};const r=await f.invoke('import-product-proof');await f.invoke('sign-product-proof',{token:r.token,fingerprint:r.review.fingerprint,password:fixture.password});assert.equal(f.state.signs,1);assert.equal(await f.c.authorizationStore.load(fixture.vault.public.deviceId,fixture.request.fingerprint.slice(2)),null);
 const fresh=await controller(f.directory),rows=await fresh.invoke('list-product-proofs');assert.equal(rows[0].state,'authorized');await fresh.invoke('export-product-proof',{id:fixture.request.fingerprint});assert.equal(fresh.state.signs,0);assert.equal(fresh.state.exports,1);
});

test('private-proof original response import restores only its committed authorization without signing again',async()=>{
 const f=await controller(),r=await f.invoke('import-product-proof');await f.invoke('sign-product-proof',{token:r.token,fingerprint:r.review.fingerprint,password:fixture.password});
 const id=fixture.request.fingerprint.slice(2),original=await f.c.authorizationStore.load(fixture.vault.public.deviceId,id);
 for(const store of [f.c.authorizationStore,f.c.signingAttempts.results])for(const file of await store.candidates(fixture.vault.public.deviceId,id))await fs.rename(file,file+'.preserved-test-copy');
 const handlers=new Map(),{installSigningRecovery}=require('../tools/native-signing-recovery.cjs'),{productProofReview}=require('../dist/hinkal-product-proof.cjs');
 installSigningRecovery({register:(n,fn)=>handlers.set(n,fn),attempts:f.c.signingAttempts,getPublic:f.c.getPublic,getVault:f.c.getVault,getWindow:f.c.getWindow,getVaultHash:()=>require('node:crypto').createHash('sha256').update(JSON.stringify(f.c.getVault())).digest('hex'),clearPending:()=>f.ui.clear(),openJSON:async()=>({data:original.response}),dialog:f.c.dialog,
  verify:async(response,request)=>({response:await verifyProductProofResponse(request,response,Date.now(),false),review:productProofReview(request,Date.now(),false)})});
 const restored=await handlers.get('recover-signing-response')({id:fixture.request.fingerprint,authority:'private-proof'});assert.equal(restored.restored,true);assert.equal(f.state.signs,1);assert.equal(JSON.stringify(restored).includes(original.response.walletAuthorization),false);assert.deepEqual((await f.c.authorizationStore.load(fixture.vault.public.deviceId,id)).response,original.response);
});
