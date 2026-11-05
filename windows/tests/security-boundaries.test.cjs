'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url'),{randomUUID,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const root=process.env.DRIVEKEY_SECURITY_BASELINE||path.resolve(__dirname,'..'),localRequire=createRequire(path.join(root,'main.cjs'));
const {TransactionStore,reconcileRecord}=localRequire('./transaction-store.cjs'),{Wallet,Transaction}=localRequire('ethers'),payment=localRequire('./dist/payment.cjs');
async function fixture(){
 const key=Wallet.createRandom(),now=Date.now(),wallet={version:3,deviceId:randomUUID(),createdAt:new Date(now).toISOString(),evmAddress:key.address,solanaAddress:'11111111111111111111111111111111'};
 const request={version:8,action:'payment',requestId:randomUUID(),deviceId:wallet.deviceId,chain:'ethereum',network:'ethereum',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from:key.address,recipient:'0x1111111111111111111111111111111111111111',asset:'ETH',amount:'1',maximumFee:'21000',accountRent:'0',createRecipientAccount:false,blockhash:null,lastValidBlockHeight:null,unsignedTransaction:Transaction.from({type:2,chainId:1,nonce:0,to:'0x1111111111111111111111111111111111111111',value:1n,gasLimit:21000n,maxFeePerGas:1n,maxPriorityFeePerGas:0n}).unsignedSerialized};
 request.fingerprint=payment.paymentFingerprint(request);const rawSignedTransaction=await key.signTransaction(Transaction.from(request.unsignedTransaction)),response={version:8,deviceId:wallet.deviceId,requestId:request.requestId,fingerprint:request.fingerprint,signedAt:new Date(now).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash,approvalSignature:await key.signMessage(payment.paymentApproval(request))};
 payment.verifyPaymentResponse(response,request,wallet);return {wallet,record:{version:1,request,response,state:'signed'}};
}
function encryption(){const key=randomBytes(32);return {seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},unseal:async b=>{const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString();}};}
async function journal(){const {wallet,record}=await fixture(),directory=path.resolve(__dirname,'../../security-journal-'+randomUUID()),crypto=encryption(),store=new TransactionStore(directory,crypto);await store.put(record);return {wallet,record,directory,crypto,store};}

test('journal refuses changed approved bytes and all post-submission resets',async()=>{
 const {record,store}=await journal();
 await assert.rejects(()=>store.put({...record,request:{...record.request,amount:'999'}}));
 await assert.rejects(()=>store.put({...record,response:{...record.response,rawSignedTransaction:'replaced'}}));
 await assert.rejects(()=>store.put({...record,response:{...record.response,requestId:randomUUID()}}));
 await store.put({...record,state:'submitting'});
 for(const state of ['signed','prepared'])await assert.rejects(()=>store.put({...record,state}));
 await store.put({...record,state:'pending'});await store.put({...record,state:'confirmed'});
 await assert.rejects(()=>store.put({...record,state:'submitting'}));
 assert.equal((await store.load(record.request.deviceId,record.request.fingerprint)).state,'confirmed');
});
test('journal rejects unknown states, response transplant and UTF-8 expansion before encryption',async()=>{
 const {record,store}=await journal();
 await assert.rejects(()=>store.put({...record,state:'anything'}));
 await assert.rejects(()=>store.put({...record,response:{...record.response,deviceId:randomUUID()}}));
 await assert.rejects(()=>store.put({...record,reason:'\u{1f512}'.repeat(40000)}));
});
test('journal bounds reads before decryption and rejects oversized encryption output',async()=>{
 const {record,store,directory,crypto}=await journal();let decrypts=0;
 await fs.writeFile(store.file(record.request.deviceId,record.request.fingerprint),Buffer.alloc(256*1024+1));
 const bounded=new TransactionStore(directory,{...crypto,unseal:async b=>{decrypts++;return crypto.unseal(b);}});
 await assert.rejects(()=>bounded.load(record.request.deviceId,record.request.fingerprint));assert.equal(decrypts,0);
 const other=new TransactionStore(directory+'-other',{...crypto,seal:async()=>Buffer.alloc(256*1024+1)});
 await assert.rejects(()=>other.put(record));assert.equal(await other.load(record.request.deviceId,record.request.fingerprint),null);
});
test('reconciliation keeps immutable payloads and nests worker evidence',async()=>{
 const {record}=await fixture();
 for(const field of ['request','response','version','updatedAt','submissionAttempted'])assert.throws(()=>reconcileRecord(record,{state:'confirmed',[field]:{poison:true}}));
 for(const result of [{state:'signed'},{state:'confirmed',reason:{secret:true}}])assert.throws(()=>reconcileRecord(record,result));
 const next=reconcileRecord(record,{state:'confirmed',receipt:{status:'0x1'},customEvidence:'retained'});
 assert.equal(next.request,record.request);assert.equal(next.response,record.response);assert.equal(next.receipt,undefined);assert.equal(next.settlement.customEvidence,'retained');
 assert.throws(()=>reconcileRecord({...record,request:{...record.request,version:25}},{state:'confirmed'}));
});

async function mainHarness(answer,options={}){
 const directory=path.resolve(__dirname,'../../security-main-'+randomUUID());await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'rpc-endpoints-v1.json'),'{}');
 const handlers=new Map(),crypto=encryption();let child;
 const electron={app:{commandLine:{appendSwitch:()=>{}},requestSingleInstanceLock:()=>true,on:()=>{},getPath:()=>directory,whenReady:()=>({then:()=>{}}),isPackaged:!!options.integrityGate},ipcMain:{handle:(n,f)=>handlers.set(n,f)},safeStorage:{isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:crypto.seal,decryptStringAsync:async b=>({result:await crypto.unseal(b)})}};
 const spawn=(exe,args,options)=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr={resume:()=>{}};child.stdin=new EventEmitter();child.killed=false;child.kill=()=>{child.killed=true;return true;};child.stdin.end=input=>{child.input=JSON.parse(input);child.options=options;if(answer!==null)setImmediate(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify(answer)));child.emit('close',answer.ok?0:1,null);});};return child;};
 const integrityBytes=Buffer.from('test runtime integrity'),digest=require('node:crypto').createHash('sha256').update(integrityBytes).digest('hex'),sandboxProcess=Object.create(process);sandboxProcess.resourcesPath=directory;
 const files=options.integrityGate?{...fs,readFile:async(file,...args)=>{if(file.endsWith('node.exe')||file.endsWith('worker.cjs')){await options.integrityGate();return integrityBytes;}return fs.readFile(file,...args);}}:fs;
 const sandbox={require:id=>id==='electron'?electron:id==='node:child_process'?{spawn}:id==='node:fs/promises'?files:id==='./RUNTIME-INTEGRITY.json'&&options.integrityGate?{'node.exe':digest,'dist/worker.cjs':digest}:localRequire(id),module:{exports:{}},__dirname:root,process:sandboxProcess,Buffer:options.Buffer||Buffer,setTimeout,clearTimeout,AbortController};
 vm.runInNewContext(syncFs.readFileSync(path.join(root,'main.cjs'),'utf8')+'\nmodule.exports={readJSON,job,transactionStore,signatureStore,trackPublicRead:controller=>publicReadControllers.add(controller),setContext:(w,x)=>{publicWallet=w;win=x;},cancel:()=>{for(const f of activeWorkers)f();}};',sandbox,{filename:path.join(root,'main.cjs')});
 const api=sandbox.module.exports,window={webContents:{mainFrame:{url:pathToFileURL(path.join(root,'ui/index.html')).href}}},event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 api.setContext(undefined,window);
 return {...api,handlers,event,window,getChild:()=>child};
}
test('real main IPC rejects network payload replacement and preserves approved signature',async()=>{
 const {wallet,record}=await fixture(),h=await mainHarness({ok:true,result:{state:'confirmed',response:{rawSignedTransaction:'poison'}}});h.setContext(wallet,h.window);await h.transactionStore.put({...record,state:'pending'});
 const result=await h.handlers.get('reconcile-payment')(h.event,{id:record.request.fingerprint});assert.equal(result.ok,false);
 const saved=await h.transactionStore.load(wallet.deviceId,record.request.fingerprint);assert.equal(saved.response.rawSignedTransaction,record.response.rawSignedTransaction);assert.equal(saved.state,'pending');
});
test('real main IPC fails closed on missing submission history and rejects unauthorized sender',async()=>{
 const {wallet,record}=await fixture(),h=await mainHarness({ok:true,result:{}});h.setContext(wallet,h.window);await h.signatureStore.save(wallet.deviceId,record.request,record.response);
 const listed=await h.handlers.get('list-transactions')(h.event);assert.equal(listed.ok,true);assert.equal(listed.result[0].state,'uncertain');
 const submitted=await h.handlers.get('submit-payment')(h.event,{id:record.request.fingerprint});assert.equal(submitted.ok,false);assert.equal(h.getChild(),undefined);
 await assert.rejects(()=>h.handlers.get('list-transactions')({...h.event,sender:{} }));
});
test('parent worker boundary suppresses arbitrary secret-bearing errors and narrows environment',async()=>{
 const sentinel='TEST_SECRET_MUST_NOT_ESCAPE_7ce312',h=await mainHarness({ok:false,error:sentinel});
 await assert.rejects(()=>h.job({action:'verify',password:sentinel}),e=>!e.message.includes(sentinel)&&e.message.includes('Local signer rejected'));
 assert.deepEqual(Object.keys(h.getChild().options.env).sort(),['PATH','SystemRoot','TEMP','TMP','WINDIR']);assert.equal(h.getChild().options.windowsHide,true);
});
test('closing a wallet cancels its outstanding worker and rejects late output',async()=>{
 const h=await mainHarness(null),pending=h.job({action:'verify',password:'throwaway test password'});const rejection=assert.rejects(()=>pending,/cancelled/);h.cancel();await rejection;
 assert.equal(h.getChild().killed,true);h.getChild().stdout.emit('data',Buffer.from('{"ok":true,"result":"late"}'));h.getChild().emit('close',0,null);
});

test('closing during packaged integrity verification never starts a signing child',async()=>{
 let release,entered;const paused=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let calls=0;
 const h=await mainHarness(null,{integrityGate:async()=>{if(++calls===1){entered();await gate;}}});
 const pending=h.job({action:'verify',password:'throwaway test password'}),rejected=assert.rejects(()=>pending,/cancelled/);
 await paused;h.setContext(undefined,undefined);release();await rejected;assert.equal(h.getChild(),undefined);
 await assert.rejects(()=>h.job({action:'verify',password:'throwaway test password'}),/cancelled/);assert.equal(h.getChild(),undefined);
});


test('JSON file errors redact malformed contents, reject invalid UTF-8 and wipe input buffers',async()=>{
 const captured=[],instrumented=Object.create(Buffer);instrumented.alloc=(...args)=>{const b=Buffer.alloc(...args);captured.push(b);return b;};
 const h=await mainHarness(null,{Buffer:instrumented});
 const dir=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'drivekey-json-test-')),file=path.join(dir,'input.json');
 try{
  for(const input of [Buffer.from('SYNTHETIC_PRIVATE_SENTINEL'),Buffer.from([0xff,0xfe])]){
   await fs.writeFile(file,input);await assert.rejects(()=>h.readJSON(file),e=>e.message==='The selected file is not valid UTF-8 JSON.');assert.ok(captured.at(-1).every(b=>b===0));
  }
  await fs.writeFile(file,'{"valid":true}');assert.equal((await h.readJSON(file)).valid,true);assert.ok(captured.at(-1).every(b=>b===0));
 }finally{await fs.unlink(file);await fs.rmdir(dir);}
});

test('native zoom accepts only finite predefined factors through the guarded main IPC',async()=>{
 const h=await mainHarness(null);let zoom=1;h.window.webContents.getZoomFactor=()=>zoom;h.window.webContents.setZoomFactor=value=>{zoom=value;};
 for(const value of [0.5,0.67,0.8,1,1.25,1.5,1.75,2]){const r=await h.handlers.get('set-interface-zoom')(h.event,{zoom:value});assert.equal(r.ok,true);assert.equal(r.result.zoom,value);}
 for(const p of [null,{}, {zoom:999},{zoom:NaN},{zoom:Infinity},{zoom:'2'},{zoom:2,extra:true}]){const r=await h.handlers.get('set-interface-zoom')(h.event,p);assert.equal(r.ok,false);assert.equal(zoom,2);}
 assert.equal((await h.handlers.get('interface-settings')(h.event)).result.zoom,2);
 await assert.rejects(()=>h.handlers.get('set-interface-zoom')({...h.event,sender:{}},{zoom:1}),/Invalid sender/);assert.equal(zoom,2);
});

test('public read IPC rejects unauthorized senders and account injection before networking',async()=>{const h=await mainHarness(null);for(const channel of ['market-snapshot','account-balances'])await assert.rejects(()=>h.handlers.get(channel)({...h.event,sender:{}},{}),/Invalid sender/);const denied=await h.handlers.get('account-balances')(h.event,{id:'11111111-1111-4111-8111-111111111111',from:'untrusted'});assert.equal(denied.ok,false);assert.equal(h.getChild(),undefined);});


test('cancelling a public observation kills its worker and rejects late data', async () => {
 const harness = await mainHarness(null);
 const controller = new AbortController();
 const pending = harness.job({action: 'observed-balance'}, 'online-worker.cjs', {signal: controller.signal});
 const rejected = assert.rejects(pending, /Public read cancelled/);
 controller.abort();
 await rejected;
 assert.equal(harness.getChild().killed, true);
 harness.getChild().stdout.emit('data', Buffer.from('{"ok":true,"result":{"amount":"999"}}'));
 harness.getChild().emit('close', 0, null);
 const alreadyCancelled = new AbortController();
 alreadyCancelled.abort();
 await assert.rejects(harness.job({action: 'observed-balance'}, 'online-worker.cjs', {signal: alreadyCancelled.signal}));
});


test('clear-session IPC cancels an outstanding portfolio worker', async () => {
 const harness = await mainHarness(null);
 const controller = new AbortController();
 harness.trackPublicRead(controller);
 const pending = harness.job({action: 'observed-balance'}, 'online-worker.cjs', {signal: controller.signal});
 const rejected = assert.rejects(pending, /Public read cancelled/);
 const cleared = await harness.handlers.get('clear-session')(harness.event);
 assert.equal(cleared.ok, true);
 await rejected;
 assert.equal(controller.signal.aborted, true);
 assert.equal(harness.getChild().killed, true);
});
