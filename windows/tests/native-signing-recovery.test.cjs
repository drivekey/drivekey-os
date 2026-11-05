'use strict';
// Actual privileged controller + genuine unfunded signature. Native dialog/file
// answers are explicit fixtures, not separate-device or live acceptance.
const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {SignatureStore}=require('../signature-store.cjs'),{SigningAttempts}=require('../tools/signing-attempts.cjs'),{installSigningRecovery}=require('../tools/native-signing-recovery.cjs');
const {verifyPaymentResponse,paymentReview}=require('../dist/payment.cjs'),{paymentRecoveryFixture}=require('./helpers/payment-recovery-fixture.cjs');let sample;
before(()=>{sample=paymentRecoveryFixture();});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function controller(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-response-import-')),key=randomBytes(32),storage={forJournal:purpose=>({seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(purpose));const b=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},unseal:async b=>{const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAAD(Buffer.from(purpose));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}})};
 const primary=new SignatureStore(path.join(directory,'signatures-v1'),storage.forJournal('signatures')),attempts=new SigningAttempts(directory,storage,{'transaction':primary}),state={wallet:structuredClone(sample.vault.public),vault:sample.vault,window:{isDestroyed:()=>false},response:structuredClone(sample.response),cancelFile:false,approval:1,opens:0,dialogs:0,verifies:0,signs:0},handlers=new Map();let ui;
 const verify=async(response,request)=>{state.verifies++;return {response:verifyPaymentResponse(response,request,state.wallet,Date.now(),false),review:paymentReview(request,Date.parse(response.signedAt))};};
 await attempts.run({walletId:state.wallet.deviceId,request:sample.request,authority:'transaction',verify:async(s,r)=>(await verify(s,r)).response,sign:async()=>{state.signs++;return structuredClone(sample.response);}});
 for(const store of [primary,attempts.results])for(const file of await store.candidates(state.wallet.deviceId,sample.request.fingerprint.slice(2)))await fs.rename(file,file+'.preserved-test-copy');
 const c={register:(n,fn)=>handlers.set(n,fn),attempts,getPublic:()=>state.wallet,getVault:()=>state.vault,getVaultHash:()=>digest(state.vault),getWindow:()=>state.window,clearPending:()=>ui?.clear(),openJSON:async()=>{state.opens++;return state.cancelFile?null:{data:structuredClone(state.response)};},verify,dialog:{showMessageBox:async()=>{state.dialogs++;return {response:state.approval};}}};ui=installSigningRecovery(c);
 return {directory,primary,attempts,state,c,ui,invoke:()=>handlers.get('recover-signing-response')({id:sample.request.fingerprint,authority:'transaction'})};
}
test('native recovery imports the exact previously signed bytes into encrypted recovery without another signing job',async()=>{
 const f=await controller(),r=await f.invoke();assert.equal(r.restored,true);assert.equal(r.transactionHash,sample.response.transactionHash);assert.equal(f.state.signs,1);assert.deepEqual((await f.attempts.recover(f.state.wallet.deviceId,sample.request.fingerprint.slice(2),'transaction',async(s,q)=>(await f.c.verify(s,q)).response)).response,sample.response);assert.equal(JSON.stringify(r).includes(sample.response.rawSignedTransaction),false);assert.equal((await f.attempts.list(f.state.wallet.deviceId,'transaction'))[0].uncertain,undefined);
});
test('canceling either native file selection or default-cancel confirmation leaves original uncertainty unchanged',async()=>{
 for(const cancelFile of [true,false]){const f=await controller();f.state.cancelFile=cancelFile;f.state.approval=0;assert.deepEqual(await f.invoke(),{cancelled:true});assert.equal(f.state.dialogs,cancelFile?0:1);assert.equal((await f.attempts.list(f.state.wallet.deviceId,'transaction'))[0].uncertain,true);assert.equal(f.state.signs,1);}
});
test('a cryptographically valid changed timestamp is still rejected before native approval by exact response commitment',async()=>{
 const f=await controller();f.state.response.signedAt=new Date(Date.parse(sample.response.signedAt)+1).toISOString();verifyPaymentResponse(f.state.response,sample.request,f.state.wallet,Date.now()+1,false);const before=f.state.verifies;await assert.rejects(f.invoke(),/retained original commitment/);assert.equal(f.state.dialogs,0);assert.equal(f.state.verifies,before);assert.equal((await f.attempts.list(f.state.wallet.deviceId,'transaction'))[0].uncertain,true);
});
test('wallet changes or approval invalidation cannot restore bytes under a new review scope',async()=>{
 const f=await controller();f.c.dialog.showMessageBox=async()=>{f.ui.clear();return {response:1};};await assert.rejects(f.invoke(),/wallet, review or window changed/);assert.equal((await f.attempts.list(f.state.wallet.deviceId,'transaction'))[0].uncertain,true);assert.equal(await f.primary.load(f.state.wallet.deviceId,sample.request.fingerprint.slice(2)),null);
});
test('missing original commitment refuses recovery before opening a file and preserves its original ciphertext elsewhere',async()=>{
 const f=await controller(),file=f.attempts.commitments.location(f.state.wallet.deviceId,sample.request.fingerprint.slice(2));await fs.rename(file,file+'.preserved-test-copy');await assert.rejects(f.invoke(),/commitment is unavailable/);assert.equal(f.state.opens,0);assert.equal(f.state.dialogs,0);assert.equal(f.state.signs,1);
});
