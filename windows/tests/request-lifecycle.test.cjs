'use strict';
// Real encrypted journals; explicit native-dialog and file-writer fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {TransactionStore}=require('../transaction-store.cjs'),{SignatureStore}=require('../signature-store.cjs'),{SigningAttempts}=require('../tools/signing-attempts.cjs');
const {preparedRecord,installRequestLifecycle}=require('../tools/request-lifecycle.cjs');
async function fixture(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-handoff-')),key=randomBytes(32),storage={forJournal:purpose=>({seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(purpose));const b=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},unseal:async b=>{const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAAD(Buffer.from(purpose));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}})};
 const wallet={deviceId:randomUUID(),evmAddress:'0x'+'1'.repeat(40)},request={version:8,action:'payment',chain:'ethereum',deviceId:wallet.deviceId,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex'),createdAt:new Date(Date.now()-10000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString(),amount:'1'},primary=new SignatureStore(path.join(directory,'signatures-v1'),storage.forJournal('signatures')),attempts=new SigningAttempts(directory,storage,{'transaction':primary});
 const store=new TransactionStore(path.join(directory,'transactions-v1'),{...storage.forJournal('transactions'),beforeDiscard:r=>attempts.assertUnstarted(r.request.deviceId,r.request.fingerprint.slice(2))});await store.put(preparedRecord(request));
 const state={wallet,approval:1,dialogs:0,window:{isDestroyed:()=>false}},handlers=new Map();let ui;
 const c={register:(n,fn)=>handlers.set(n,fn),store,attempts,getPublic:()=>state.wallet,getWindow:()=>state.window,clearPending:()=>ui?.clear(),review:r=>({fingerprint:r.fingerprint,amount:r.amount}),dialog:{showMessageBox:async()=>{state.dialogs++;return {response:state.approval};}}};ui=installRequestLifecycle(c);
 return {directory,storage,store,attempts,primary,request,wallet,state,c,ui,read:()=>store.load(wallet.deviceId,request.fingerprint),discard:()=>handlers.get('discard-prepared-request')({id:request.fingerprint})};
}
test('a known local draft can be discarded after expiry, preserving request/history and requiring a fresh immutable request',async()=>{
 const f=await fixture(),original=await f.read();assert.equal(await f.ui.canDiscard(original,f.wallet),true);await f.discard();const r=await f.read();assert.equal(r.state,'discarded');assert.deepEqual(r.request,original.request);assert.equal(r.response,undefined);await assert.rejects(f.store.put({...r,state:'prepared'}),/cannot be activated/);await assert.rejects(f.discard());
 const fresh={...f.request,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex')};await f.store.put(preparedRecord(fresh));assert.equal((await f.store.list(f.wallet.deviceId)).length,2);assert.equal((await f.read()).state,'discarded');
});
test('canceling native discard confirmation creates no terminal state or signing authority',async()=>{
 const f=await fixture();f.state.approval=0;const before=await fs.readFile(f.store.file(f.wallet.deviceId,f.request.fingerprint));assert.deepEqual(await f.discard(),{cancelled:true});assert.deepEqual(await fs.readFile(f.store.file(f.wallet.deviceId,f.request.fingerprint)),before);assert.equal((await f.attempts.attempts.list(f.wallet.deviceId)).length,0);
});
test('canceling a save picker invokes no handoff barrier and leaves the draft safely local',async()=>{
 const f=await fixture();assert.equal(await f.ui.exportRequest(f.request,async()=>null),null);assert.equal((await f.read()).handoff.state,'local-only');await f.discard();assert.equal((await f.read()).state,'discarded');
});
test('file and exchange writes see durable exposure before bytes escape and prevent later cancellation',async()=>{
 for(const via of ['file','exchange']){const f=await fixture();let writes=0;await f.ui.exportRequest(f.request,async before=>{await before();assert.equal((await f.read()).handoff.state,'export-started');writes++;return {saved:true};},via);assert.equal(writes,1);assert.equal((await f.read()).handoff.state,'exported');await assert.rejects(f.discard(),/never left/);assert.equal(f.state.dialogs,0);}
});
test('a write crash retains exposure after restart rather than reclassifying the request unsigned',async()=>{
 const f=await fixture();await assert.rejects(f.ui.exportRequest(f.request,async before=>{await before();throw Error('Injected write interruption');}),/interruption/);const r=await f.read();assert.equal(r.handoff.state,'export-started');const restarted=new TransactionStore(f.store.directory,f.storage.forJournal('transactions'));assert.equal((await restarted.load(f.wallet.deviceId,f.request.fingerprint)).handoff.state,'export-started');await assert.rejects(f.discard(),/never left/);
});
test('failure to preserve the handoff prevents the actual writer from running',async()=>{
 const f=await fixture();f.store.seal=async()=>{throw Error('Injected encrypted storage outage');};let writes=0;await assert.rejects(f.ui.exportRequest(f.request,async before=>{await before();writes++;return true;}),/outage/);assert.equal(writes,0);assert.equal((await f.read()).handoff.state,'local-only');
});
test('imported and legacy drafts cannot be relabeled local or discarded without evidence',async()=>{
 const f=await fixture();await f.ui.imported(f.request);assert.equal((await f.read()).handoff.state,'external-seen');await assert.rejects(f.discard(),/never left/);await assert.rejects(f.store.put(preparedRecord(f.request)),/immutable|reset/);
 const request={...f.request,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex')};await f.store.put({version:1,request,state:'prepared'});await assert.rejects(f.store.put(preparedRecord(request)),/Earlier records/);assert.equal(await f.ui.canDiscard(await f.store.load(f.wallet.deviceId,request.fingerprint),f.wallet),false);
});
test('an attempted or existing signature blocks handoff and discard even if the prepared row has no response',async()=>{
 const f=await fixture();await f.attempts.attempts.claim(f.wallet.deviceId,f.request,f.attempts.marker(f.request,'transaction'));let writes=0;await assert.rejects(f.ui.exportRequest(f.request,async before=>{await before();writes++;return true;}),/signing authority/);await assert.rejects(f.discard(),/signing authority/);assert.equal(writes,0);assert.equal((await f.read()).state,'prepared');
});
test('private-authorized local chain drafts retain their original notes/reservation and cannot be discarded',async()=>{
 const f=await fixture(),old=await f.read(),request={...f.request,version:29,requestId:randomUUID(),fingerprint:'0x'+randomBytes(32).toString('hex')};await f.store.put(preparedRecord(request,{productProof:{fixture:'existing private authorization'}}));assert.equal(await f.ui.canDiscard(await f.store.load(f.wallet.deviceId,request.fingerprint),f.wallet),false);assert.equal((await f.read()).request.fingerprint,old.request.fingerprint);
});
test('scope changes during native approval fail before discard and do not lose the draft',async()=>{
 const f=await fixture();f.c.dialog.showMessageBox=async()=>{f.state.wallet={...f.wallet,deviceId:randomUUID()};return {response:1};};await assert.rejects(f.discard(),/wallet, review or window changed/);assert.equal((await f.read()).state,'prepared');
});
test('removing or downgrading exposure and importing an already discarded draft fail closed',async()=>{
 const f=await fixture();await f.ui.exportRequest(f.request,async before=>{await before();return true;});const r=await f.read();for(const handoff of [undefined,{version:1,origin:'local-preparation',state:'local-only'},{...r.handoff,state:'export-started',completedAt:undefined}])await assert.rejects(f.store.put({...r,handoff}));
 const g=await fixture();await g.discard();await assert.rejects(g.ui.imported(g.request),/cannot be activated/);
});
