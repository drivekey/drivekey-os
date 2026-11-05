'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {installRouteUi,readDocument}=require('../ui-routes-main.cjs');
function context(){
  const handlers=new Map(),window={isDestroyed:()=>false},wallet={deviceId:'a8e25d4f-36d8-46cb-b129-728b8f354790',evmAddress:'0x1111111111111111111111111111111111111111',solanaAddress:'11111111111111111111111111111111'};
  const calls=[],c={register:(name,fn)=>handlers.set(name,fn),dialog:{showOpenDialog:async()=>({canceled:true})},getPublic:()=>wallet,getWindow:()=>window,isOffline:()=>false,clearPending:()=>calls.push('clear'),setPending:value=>{c.pending=value;calls.push('set');},getVaultHash:()=>null,online:async()=>{calls.push('online');throw Error('No network expected.');},transactionStore:{put:async()=>calls.push('store'),load:async()=>null},validateIntent:()=>{},assertIntentWallet:()=>{},reviewIntent:()=>({}),verifyIntent:()=>calls.push('verify'),bridgeCodec:()=>null,clipboard:{value:'',writeText(text){this.value=text;calls.push(['clipboard',text]);},readText(){return Promise.resolve(this.value);}},makePaymentQR:async(publicIdentity,input)=>{calls.push(['qr',publicIdentity,input]);return {uri:'chain:recomputed-public-request'};}};
  installRouteUi(c);return {handlers,c,calls,wallet,window};
}
test('canceling native import does not call network or create a journal',async()=>{
  const s=context();assert.deepEqual(await s.handlers.get('import-prepared-private')({chain:'ethereum',action:'withdraw'}),{cancelled:true});assert.deepEqual(s.calls,['clear']);
});
test('offline mode rejects preparation before any file picker or worker',async()=>{
  const s=context();s.c.isOffline=()=>true;await assert.rejects(()=>s.handlers.get('import-prepared-private')({chain:'ethereum',action:'swap'}),/offline companion/);assert.deepEqual(s.calls,[]);
});
test('switching wallet during picker discards import without reading file',async()=>{
  const s=context();s.c.dialog.showOpenDialog=async()=>{s.wallet.deviceId='another-wallet';return {canceled:false,filePaths:['does-not-exist']};};await assert.rejects(()=>s.handlers.get('import-prepared-private')({chain:'ethereum',action:'withdraw'}),/wallet or window changed/);assert.deepEqual(s.calls,['clear']);
});
test('review invalidation clears pending memory only',async()=>{
  const s=context();assert.deepEqual(await s.handlers.get('invalidate-prepared-review')(),{cleared:true});assert.deepEqual(s.calls,['clear']);
});
test('copy request recomputes from selected public identity and never trusts a supplied URI',async()=>{
  const s=context(),input={chain:'ethereum',asset:'USDC',amount:'1'};assert.deepEqual(await s.handlers.get('copy-payment-request')(input),{copied:true});assert.equal(s.calls[0][0],'qr');assert.deepEqual(s.calls[0][1],s.wallet);assert.deepEqual(s.calls[0][2],input);assert.deepEqual(s.calls[1],['clipboard','chain:recomputed-public-request']);
});
test('wallet switch during QR generation prevents copying stale data',async()=>{
  const s=context();s.c.makePaymentQR=async()=>{s.wallet.evmAddress='changed';return {uri:'stale'};};await assert.rejects(()=>s.handlers.get('copy-payment-request')({}),/wallet changed/);assert.equal(s.calls.some(v=>Array.isArray(v)&&v[0]==='clipboard'),false);
});
test('clipboard success waits for write completion and rejected writes propagate',async()=>{
  const s=context();let complete;const pending=new Promise(resolve=>{complete=resolve;});s.c.clipboard.writeText=()=>pending;s.c.clipboard.readText=async()=>'chain:recomputed-public-request';
  let finished=false;const copying=s.handlers.get('copy-payment-request')({}).then(()=>{finished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);complete();await copying;assert.equal(finished,true);
  s.c.clipboard.writeText=async()=>{throw Error('Clipboard unavailable.');};await assert.rejects(()=>s.handlers.get('copy-payment-request')({}),/Clipboard unavailable/);s.c.clipboard.writeText=async()=>{};s.c.clipboard.readText=async()=>'';await assert.rejects(()=>s.handlers.get('copy-payment-request')({}),/Clipboard unavailable/);
});
test('readDocument rejects duplicate route, invalid UTF-8 and oversized files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-import-fixture-'));try{
    const file=path.join(dir,'fixture.json');await fs.writeFile(file,'{"version":1,"kind":"drivekey-preparation","route":"hinkal-evm","route":"evil","input":{}}');await assert.rejects(()=>readDocument(file));
    await fs.writeFile(file,Buffer.from([0xff,0xfe,0x41]));await assert.rejects(()=>readDocument(file),/UTF-8/);
    await fs.writeFile(file,Buffer.alloc(256*1024+1,32));await assert.rejects(()=>readDocument(file),/256 KiB/);
  }finally{const resolved=path.resolve(dir),parent=path.resolve(os.tmpdir())+path.sep;assert.ok(resolved.startsWith(parent)&&path.basename(resolved).startsWith('drivekey-import-fixture-'));await fs.rm(resolved,{recursive:true,force:true});}
});
test('historical private review remains readable without returning proof or signature bytes',async()=>{
  const s=context(),fixture=require('./fixtures/hinkal-solana-private-payment.json'),r=fixture.request;
  Object.assign(s.wallet,{deviceId:r.deviceId,solanaAddress:r.from});s.c.transactionStore.load=async()=>({version:1,request:r,response:{transactionHash:'fixture-hash',rawSignedTransaction:'never-return'},state:'signed',updatedAt:'2026-11-03T00:00:00Z'});
  const detail=await s.handlers.get('get-transaction')({id:r.fingerprint});assert.equal(detail.id,r.fingerprint);assert.equal(detail.review.amount,r.amount);assert.equal(detail.transactionHash,'fixture-hash');assert.equal(JSON.stringify(detail).includes('never-return'),false);assert.equal('proofSeed' in detail,false);assert.equal('inputNotes' in detail.review,false);assert.ok(s.calls.includes('verify'));
});
function paymentRecord(s,{expired=false}={}){
  const core=require('../dist/payment.cjs'),{Transaction}=require('ethers'),now=Date.now(),request={version:8,action:'payment',requestId:'0499bc27-de68-40d8-bf67-d1a3df7797f0',deviceId:s.wallet.deviceId,chain:'ethereum',network:'ethereum',createdAt:new Date(now-120000).toISOString(),expiresAt:new Date(expired?now-1:now+60000).toISOString(),from:s.wallet.evmAddress,recipient:'0x2222222222222222222222222222222222222222',asset:'ETH',amount:'1',maximumFee:'21000',accountRent:'0',createRecipientAccount:false,blockhash:null,lastValidBlockHeight:null,unsignedTransaction:Transaction.from({type:2,chainId:1,nonce:0,to:'0x2222222222222222222222222222222222222222',value:1n,gasLimit:21000n,maxFeePerGas:1n,maxPriorityFeePerGas:0n}).unsignedSerialized};request.fingerprint=core.paymentFingerprint(request);
  s.c.validateIntent=r=>core.validatePayment(r);s.c.assertIntentWallet=(r,w)=>core.assertPaymentWallet(r,w);s.c.reviewIntent=r=>core.paymentReview(r);
  const record={version:1,request,state:'prepared'};s.c.transactionStore.load=async(id,key)=>{assert.equal(id,s.wallet.deviceId);assert.equal(key,request.fingerprint);return record;};return record;
}
test('resume prepared request mints review of identical bytes without picker, network or journal change',async()=>{
  const s=context(),record=paymentRecord(s),original=JSON.stringify(record);s.c.dialog.showOpenDialog=async()=>{throw Error('No picker allowed.');};s.c.isOffline=()=>true;
  const result=await s.handlers.get('review-saved-request')({id:record.request.fingerprint});assert.match(result.token,/^[0-9a-f-]{36}$/);assert.equal(result.review.fingerprint,record.request.fingerprint);assert.equal(s.c.pending.request.unsignedTransaction,record.request.unsignedTransaction);assert.equal(JSON.stringify(record),original);assert.deepEqual(s.calls,['clear','set']);
});
test('resume rejects expired, already-signed and wrong-wallet requests without pending authority',async()=>{
  for(const mutate of [(_s,r)=>{r.state='signed';},(_s,r)=>{r.response={transactionHash:'signature'};},(_s,r)=>{r.request.deviceId='another-wallet';},(_s,r)=>{r.request.from='0x3333333333333333333333333333333333333333';}]){
    const s=context(),record=paymentRecord(s);mutate(s,record);await assert.rejects(()=>s.handlers.get('review-saved-request')({id:record.request.fingerprint}));assert.equal(s.c.pending,undefined);assert.deepEqual(s.calls,['clear']);
  }
  const s=context(),record=paymentRecord(s,{expired:true});await assert.rejects(()=>s.handlers.get('review-saved-request')({id:record.request.fingerprint}),/expired/);assert.equal(s.c.pending,undefined);
});
test('resume rejects wallet changes during journal read and malformed identifiers',async()=>{
  const s=context(),record=paymentRecord(s),load=s.c.transactionStore.load;s.c.transactionStore.load=async(...args)=>{const r=await load(...args);s.wallet.deviceId='changed';return r;};await assert.rejects(()=>s.handlers.get('review-saved-request')({id:record.request.fingerprint}),/wallet or window changed/);assert.equal(s.c.pending,undefined);
  await assert.rejects(()=>s.handlers.get('review-saved-request')({id:'bad',path:'arbitrary'}),/Invalid transaction identity/);
});
