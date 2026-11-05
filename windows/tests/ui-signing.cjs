'use strict';
// Native Electron + actual cryptographic workers. Dialogs are replaced only in
// this development test process. No production hook, mainnet RPC or funded key.
const {_electron}=require('@playwright/test'),{createServer}=require('node:http'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,randomBytes,createHash}=require('node:crypto'),{Transaction}=require('ethers');
const {verifyPaymentResponse}=require('../dist/payment.cjs');
const root=path.resolve(__dirname,'..'),workspace=path.resolve(root,'../..'),scratch=path.join(root,'work','ui-signing-'+randomUUID());
const outArg=process.argv.slice(2).find(a=>a.startsWith('--out='));if(process.argv.slice(2).some(a=>!a.startsWith('--out=')))throw Error('Only --out=<report.json> is supported.');
const out=outArg?path.resolve(outArg.slice(6)):path.join(root,'verification','UI-SIGNING.json');
function confined(base,file){const rel=path.relative(path.resolve(base),path.resolve(file));assert.ok(rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel),'Test path escapes its root.');return path.resolve(file);}
confined(workspace,out);confined(root,scratch);
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFile(file){for(let i=0;i<150;i++){try{const text=await fs.readFile(file,'utf8');return JSON.parse(text);}catch{}await delay(100);}throw Error('Expected synthetic fixture file was not written.');}
async function run(){
  await fs.mkdir(scratch,{recursive:true});await fs.mkdir(path.dirname(out),{recursive:true});
  const observedFiles=['main.cjs','preload.cjs','tools/request-exchange.cjs','ui/index.html','ui/shell.js','ui/routes.js','dist/worker.cjs','dist/online-worker.cjs'];
  const sourceHashes=Object.fromEntries(await Promise.all(observedFiles.map(async file=>[file,await hash(path.join(root,file))])));
  const entropy=randomBytes(36);let password=entropy.toString('base64');entropy.fill(0);
  let broadcasts=0,knownHash=null,phase='start',app,page,rpc,firstWallet,request,savedResponse,signatureId;
  const checks=[],rendererErrors=[],unexpectedRpc=[];
  const report={version:1,passed:false,startedAt:new Date().toISOString(),scope:'Development Electron with production source, real local cryptography and Windows DPAPI. Native dialog replies are substituted in the test process. Separate online/offline profiles; synthetic Sepolia RPC only.',scratch,sourceHashes,checks,liveMainnetTransactions:0,liveNetworkBroadcasts:0,syntheticSepoliaSignatures:0,loopbackBroadcasts:0,physicalTwoComputerTest:false,productionTestHooks:false};
  const walletFile=path.join(scratch,'wallet-encrypted.json'),backupFile=path.join(scratch,'backup-encrypted.json'),publicFile=path.join(scratch,'wallet-public.json'),requestFile=path.join(scratch,'request-unsigned.json'),responseFile=path.join(scratch,'response-signed.json');
  const profiles={online:path.join(scratch,'online-profile'),offline:path.join(scratch,'offline-profile')};
  const recipient='0x2222222222222222222222222222222222222222';
  try{
    rpc=createServer(async(req,res)=>{
      try{
        assert.equal(req.socket.localAddress,'127.0.0.1');let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('Oversized loopback request.');}const j=JSON.parse(text);let result;
        switch(j.method){
          case 'eth_chainId':result='0xaa36a7';break;
          case 'eth_getBalance':result='0xde0b6b3a7640000';break;
          case 'eth_getTransactionCount':result='0x0';break;
          case 'eth_gasPrice':result='0x3b9aca00';break;
          case 'eth_estimateGas':result='0x5208';break;
          case 'eth_call':result='0x';break;
          case 'eth_sendRawTransaction':{const tx=Transaction.from(j.params[0]);assert.equal(tx.chainId,11155111n);assert.ok(tx.signature);assert.equal(tx.to.toLowerCase(),recipient.toLowerCase());broadcasts++;assert.equal(broadcasts,1,'Unexpected duplicate loopback broadcast.');knownHash=tx.hash;result=tx.hash;break;}
          case 'eth_getTransactionReceipt':result=null;break;
          case 'eth_getTransactionByHash':result=knownHash===j.params[0]?{hash:knownHash}:null;break;
          default:unexpectedRpc.push(j.method);throw Error('Unexpected loopback RPC method.');
        }
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:j.id,result}));
      }catch{res.writeHead(500);res.end();}
    });
    await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
    const rpcFile=path.join(scratch,'loopback-rpc.json');await fs.writeFile(rpcFile,JSON.stringify({sepolia:'http://127.0.0.1:'+rpc.address().port}));
    async function launch(mode){
      const profile=profiles[mode];for(const child of ['Roaming','Local','Temp'])await fs.mkdir(path.join(profile,child),{recursive:true});
      const env={};for(const name of ['SystemRoot','WINDIR','PATH','USERPROFILE'])if(process.env[name])env[name]=process.env[name];Object.assign(env,{APPDATA:path.join(profile,'Roaming'),LOCALAPPDATA:path.join(profile,'Local'),TEMP:path.join(profile,'Temp'),TMP:path.join(profile,'Temp'),DRIVEKEY_NODE:process.execPath,...mode==='offline'?{DRIVEKEY_OFFLINE:'1'}:{}});
      app=await _electron.launch({executablePath:require('electron'),args:[root,'--user-data-dir='+profile,'--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],env,timeout:45000});
      page=await app.firstWindow();page.on('pageerror',error=>rendererErrors.push(error.message));await page.waitForFunction(()=>document.body.dataset.ready==='true',{},{timeout:45000});
      const actualProfile=await app.evaluate(({app})=>app.getPath('userData'));confined(scratch,actualProfile);
      assert.equal(await app.evaluate(async({safeStorage})=>safeStorage.isAsyncEncryptionAvailable()),true);
      await app.evaluate(({dialog})=>{
        global.__uiSigningDialogs={open:[],save:[],confirm:[],confirmations:[]};
        dialog.showOpenDialog=async()=>{const q=global.__uiSigningDialogs;if(!q.open.length)throw Error('Unexpected native open dialog.');const file=q.open.shift();return file===null?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[file]};};
        dialog.showSaveDialog=async()=>{const q=global.__uiSigningDialogs;if(!q.save.length)throw Error('Unexpected native save dialog.');const file=q.save.shift();return file===null?{canceled:true}:{canceled:false,filePath:file};};
        dialog.showMessageBox=async(_window,options)=>{const q=global.__uiSigningDialogs;q.confirmations.push({defaultId:options.defaultId,cancelId:options.cancelId,buttons:options.buttons,title:options.title});if(!q.confirm.length)throw Error('Unexpected native confirmation.');return {response:q.confirm.shift()};};
      });
      assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(async()=>fetch('https://example.invalid').then(()=>true,()=>false)),false);
      return actualProfile;
    }
    async function queue(kind,value){await app.evaluate((_electron,{kind,value})=>global.__uiSigningDialogs[kind].push(value),{kind,value});}
    async function api(method,...args){return page.evaluate(async({method,args})=>window.drivekey[method](...args),{method,args});}
    async function good(resultPromise){const result=await resultPromise;assert.equal(result.ok,true,result.error||'Native API failed.');return result.result;}
    async function idle(){await page.waitForFunction(()=>document.querySelector('.workspace')?.getAttribute('aria-busy')==='false');}
    async function nav(view){await idle();await page.locator('.nav-item[data-view="'+view+'"]').click();await page.waitForFunction(view=>document.querySelector('[data-page="'+view+'"]')?.hidden===false,view);await idle();}
    async function close(){if(app){await app.close();app=null;page=null;}}
    async function useWallet(id){await nav('vault');await page.locator('[data-wallet-id="'+id+'"]').getByRole('button',{name:'Use wallet',exact:true}).click();await page.waitForFunction(id=>window.DK.context().activeId===id,id);await idle();}
    async function verifyBackup(){await nav('security');await queue('open',backupFile);await page.fill('#backup-pass',password);await page.locator('#backup-form button[type="submit"]').click();await page.waitForFunction(()=>window.DK.context().backupVerified===true);await idle();}
    async function preparePayment(){await nav('payments');await choose(page,'#payment-chain','sepolia');await page.fill('#payment-recipient',recipient);await page.fill('#payment-amount','0.000001');await page.locator('#payment-form button[type="submit"]').click();await page.waitForFunction(()=>Boolean(window.DK.context().review));await idle();const review=await page.evaluate(()=>window.DK.context().review);assert.equal(review.chain,'sepolia');assert.match(await page.locator('#terms').textContent(),/Sepolia · Testnet/);assert.match(await page.locator('#terms').textContent(),/0\.000001 ETH/);return page.evaluate(()=>({token:window.DK.context().token,fingerprint:window.DK.context().review.fingerprint}));}
    async function sign(choice,savePath){await queue('confirm',choice);if(choice===1)await queue('save',savePath);await page.check('#approval');await page.fill('#sign-pass',password);await page.click('#sign-submit');await idle();}
    async function openDetail(id){await nav('activity');await page.locator('#activity-list [data-transaction-id="'+id+'"]').click();await page.waitForSelector('#transaction-dialog[open]');await idle();}

    phase='create-online-wallet';const onlineProfile=await launch('online');await page.click('#start');await page.fill('#new-wallet-name','Synthetic signer');await page.fill('#new-pass',password);await page.fill('#confirm-pass',password);await queue('save',walletFile);await page.locator('#create-form button[type="submit"]').click();await page.waitForFunction(()=>Boolean(window.DK.context().public));await idle();firstWallet=await page.evaluate(()=>({id:window.DK.context().activeId,public:window.DK.context().public}));checks.push('Wallet created through UI in isolated profile.');
    phase='backup-and-config';await nav('security');await queue('save',backupFile);await page.click('#backup');await waitFile(backupFile);await idle();await verifyBackup();await nav('vault');await queue('save',publicFile);await page.click('#public');await waitFile(publicFile);await idle();await nav('settings');await queue('open',rpcFile);await page.click('#configure-rpc');await page.waitForFunction(()=>document.querySelector('#rpc-status').textContent.includes('imported'));await idle();checks.push('Encrypted backup saved/verified and loopback-only RPC configured through UI.');
    phase='cancel-consumes-token';const canceled=await preparePayment();await sign(0);await page.waitForFunction(()=>document.querySelector('#toast-message').textContent.includes('Approval canceled'));const reused=await api('sign',canceled.token,canceled.fingerprint,password);assert.equal(reused.ok,false);assert.equal((await good(api('listSignatures'))).length,0);checks.push('Native cancel consumes approval token; reuse rejected without a signature.');
    phase='export-new-request';const prepared=await preparePayment();await queue('save',requestFile);await page.click('#export-payment');request=await waitFile(requestFile);assert.equal(request.fingerprint,prepared.fingerprint);assert.equal(request.chain,'sepolia');assert.equal(Transaction.from(request.unsignedTransaction).chainId,11155111n);assert.equal(Transaction.from(request.unsignedTransaction).signature,null);await idle();await close();

    phase='offline-open-and-sign';const offlineProfile=await launch('offline');await nav('vault');await queue('open',walletFile);await page.click('#add-wallet-file');await page.waitForFunction(()=>Boolean(window.DK.context().public));await idle();await verifyBackup();await nav('review');await queue('open',requestFile);await page.click('#import');await page.waitForFunction(()=>Boolean(window.DK.context().review));await idle();await sign(1,null);await page.waitForSelector('#signed:not([hidden])');assert.match(await page.locator('#signed-message').textContent(),/Export was canceled/);assert.equal(broadcasts,0);const signatures=await good(api('listSignatures'));assert.equal(signatures.length,1);signatureId=signatures[0].id;report.syntheticSepoliaSignatures=1;
    phase='offline-reexport';await page.locator('#signed [data-view="signatures"]').click();await page.waitForSelector('[data-signature-id="'+signatureId+'"]');await queue('confirm',1);await queue('save',responseFile);await page.locator('[data-signature-id="'+signatureId+'"] button').click();savedResponse=await waitFile(responseFile);verifyPaymentResponse(savedResponse,request,firstWallet.public);assert.equal(savedResponse.transactionHash,signatures[0].transactionHash);await idle();const confirmations=await app.evaluate(()=>global.__uiSigningDialogs.confirmations);assert.ok(confirmations.length>=2);for(const confirm of confirmations){assert.equal(confirm.defaultId,0);assert.equal(confirm.cancelId,0);}checks.push('Offline UI signs exact synthetic Sepolia request; canceled export retains one DPAPI response; re-export creates no new signature.');
    await close();

    phase='offline-restart-recovery';await launch('offline');const offlineWallets=await good(api('listWallets'));assert.equal(offlineWallets.wallets.length,1);await useWallet(offlineWallets.wallets[0].id);assert.equal(await page.evaluate(()=>window.DK.context().backupVerified),false);await nav('signatures');const recovered=await good(api('listSignatures'));assert.equal(recovered.length,1);assert.equal(recovered[0].transactionHash,savedResponse.transactionHash);assert.equal(recovered[0].id,signatureId);await page.waitForSelector('[data-signature-id="'+signatureId+'"]');checks.push('Restart recovers identical saved response without a passphrase or another signature.');await close();

    phase='online-resume-and-import';await launch('online');await useWallet(firstWallet.id);await openDetail(request.fingerprint);await page.locator('#transaction-detail').getByRole('button',{name:'Review & export request',exact:true}).click();await page.waitForSelector('#review-loaded:not([hidden])');await idle();assert.equal(await page.evaluate(()=>window.DK.context().review.fingerprint),request.fingerprint);await queue('open',responseFile);await page.click('#import-payment');await page.waitForFunction(()=>document.querySelector('#toast-message').textContent.includes('Signed response verified'));await idle();const imported=(await good(api('listTransactions'))).find(r=>r.id===request.fingerprint);assert.equal(imported.state,'signed');assert.equal(imported.transactionHash,savedResponse.transactionHash);checks.push('Original online prepared journal resumes through Activity and imports/validates the offline response through UI.');
    phase='cancel-submit';await openDetail(request.fingerprint);await queue('confirm',0);await page.locator('#transaction-detail').getByRole('button',{name:'Submit approved transaction',exact:true}).click();await idle();assert.equal(broadcasts,0);assert.equal((await good(api('listTransactions'))).find(r=>r.id===request.fingerprint).state,'signed');
    phase='single-loopback-submit';await queue('confirm',1);await page.locator('#transaction-detail').getByRole('button',{name:'Submit approved transaction',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#transaction-detail').textContent.includes('Pending'));await idle();assert.equal(broadcasts,1);const duplicate=await api('submitPayment',request.fingerprint);assert.equal(duplicate.ok,false);assert.equal(broadcasts,1);await page.locator('#transaction-detail').getByRole('button',{name:'Check status',exact:true}).click();await idle();assert.equal((await good(api('listTransactions'))).find(r=>r.id===request.fingerprint).state,'pending');checks.push('Native submit defaults to Cancel; loopback broadcast occurs once; duplicate submit rejected; pending reconciled.');
    if(await page.locator('#transaction-dialog').evaluate(e=>e.open))await page.click('#close-transaction');

    phase='missing-journal-recovery';const journal=confined(onlineProfile,path.join(onlineProfile,'transactions-v1',firstWallet.public.deviceId,request.fingerprint.slice(2)+'.bin')),preserved=confined(scratch,path.join(scratch,'preserved-pending-journal.bin'));await fs.rename(journal,preserved);const noHistory=(await good(api('listTransactions'))).find(r=>r.id===request.fingerprint);assert.equal(noHistory.state,'uncertain');assert.equal(noHistory.transactionHash,savedResponse.transactionHash);assert.equal(broadcasts,1);await nav('activity');await page.waitForFunction(()=>[...document.querySelectorAll('#activity-list .pill')].some(e=>e.textContent==='Outcome unknown'));await openDetail(request.fingerprint);assert.equal(await page.locator('#transaction-detail').getByRole('button',{name:'Submit approved transaction',exact:true}).count(),0);await page.locator('#transaction-detail').getByRole('button',{name:'Check status',exact:true}).click();await idle();assert.equal(broadcasts,1);checks.push('Missing submission journal restores uncertain state and identical hash; only reconciliation offered.');if(await page.locator('#transaction-dialog').evaluate(e=>e.open))await page.click('#close-transaction');

    phase='wrong-wallet';await nav('vault');await page.click('#new-wallet');await page.fill('#new-wallet-name','Second synthetic wallet');await page.fill('#new-pass',password);await page.fill('#confirm-pass',password);await queue('save',path.join(scratch,'second-wallet-encrypted.json'));await page.locator('#create-form button[type="submit"]').click();await page.waitForFunction(id=>window.DK.context().activeId!==id&&Boolean(window.DK.context().public),firstWallet.id);await idle();assert.equal((await good(api('listTransactions'))).length,0);assert.equal((await api('getTransaction',request.fingerprint)).ok,false);await queue('open',responseFile);assert.equal((await api('importPaymentResponse')).ok,false);checks.push('A second wallet cannot view or import the first wallet response.');
    phase='watch-only';await queue('open',publicFile);await page.click('#import-watch');await page.waitForFunction(()=>window.DK.context().watchOnly===true);await idle();const watch=await preparePayment();assert.equal(await page.locator('#sign-submit').isEnabled(),false);assert.equal(await page.locator('#sign-pass').isEnabled(),false);assert.match(await page.locator('#sign-gate').textContent(),/public wallet/i);assert.equal((await api('sign',watch.token,watch.fingerprint,password)).ok,false);await queue('save',path.join(scratch,'watch-only-request.json'));await page.click('#export-payment');await waitFile(path.join(scratch,'watch-only-request.json'));await idle();checks.push('Watch-only UI can prepare/export but cannot approve or sign.');
    phase='exchange-folder-before-prepare';
    const exchangeRoot=path.join(scratch,'request-exchange');await fs.mkdir(exchangeRoot);
    await nav('review');await queue('open',exchangeRoot);await page.click('#choose-exchange-folder');await idle();
    assert.match(await page.locator('#exchange-folder-status').textContent(),/request-exchange/);
    const exchanged=await preparePayment();await page.click('#export-payment');await idle();
    const children=await fs.readdir(exchangeRoot);assert.equal(children.length,1);
    const exchangeDirectory=path.join(exchangeRoot,children[0]);
    const exchangeRequestFile=path.join(exchangeDirectory,'request.json');
    const exchangeResponseFile=path.join(exchangeDirectory,'signed-response.json');
    const exchangeRequest=await waitFile(exchangeRequestFile);assert.equal(exchangeRequest.fingerprint,exchanged.fingerprint);
    await fs.writeFile(exchangeResponseFile,JSON.stringify(savedResponse));
    assert.equal((await api('importExchangeResponse')).ok,false,'An unrelated valid signature must not import.');
    await fs.rename(exchangeResponseFile,path.join(exchangeDirectory,'rejected-response.json'));
    const onlineApp=app,onlinePage=page;
    try {
      await launch('offline');await useWallet(offlineWallets.wallets[0].id);await verifyBackup();await nav('review');
      await queue('open',exchangeRequestFile);await page.click('#import');await idle();await sign(1,exchangeResponseFile);
      const exchangeResponse=await waitFile(exchangeResponseFile);verifyPaymentResponse(exchangeResponse,exchangeRequest,firstWallet.public);
      report.syntheticSepoliaSignatures++;
      await close();
    } finally {app=onlineApp;page=onlinePage;}
    await page.click('#import-exchange');await idle();
    const exchangedRecord=(await good(api('listTransactions'))).find(row=>row.id===exchanged.fingerprint);
    assert.equal(exchangedRecord.state,'signed');
    assert.equal(exchangedRecord.transactionHash,(await waitFile(exchangeResponseFile)).transactionHash);
    assert.equal(broadcasts,1,'Exchange import must not submit.');
    await good(api('invalidatePreparedReview'));assert.equal((await api('importExchangeResponse')).ok,false);
    checks.push('Preselected watch-only exchange folder exports fresh terms, rejects another signature, imports exact real offline signature and clears binding on invalidation without submitting.');
    assert.equal(broadcasts,1);assert.deepEqual(unexpectedRpc,[]);assert.deepEqual(rendererErrors,[]);
    for(const file of observedFiles)assert.equal(await hash(path.join(root,file)),sourceHashes[file],'Application changed during signing test.');
    report.passed=true;report.loopbackBroadcasts=broadcasts;report.completedAt=new Date().toISOString();report.rendererErrors=rendererErrors;report.profileIsolationVerified=true;report.offlineProfile=offlineProfile;
  }catch(error){report.failedPhase=phase;report.error=error?.message||'Native signing UI test failed.';report.loopbackBroadcasts=broadcasts;report.completedAt=new Date().toISOString();process.exitCode=1;}
  finally{if(app)await app.close().catch(()=>{});password=undefined;if(rpc)await new Promise(resolve=>rpc.close(resolve));const text=JSON.stringify(report,null,2)+'\n';await fs.writeFile(out,text);await fs.writeFile(path.join(scratch,'UI-SIGNING.json'),text);}
  console.log(JSON.stringify({passed:report.passed,failedPhase:report.failedPhase,checks:checks.length,syntheticSepoliaSignatures:report.syntheticSepoliaSignatures,loopbackBroadcasts:broadcasts,liveMainnetTransactions:0,report:out}));
}
run().catch(error=>{console.error('UI signing harness failed: '+error.message);process.exitCode=1;});

async function choose(page,selector,value){const field=page.locator(selector);const disclosure=field.locator('xpath=ancestor::details[1]');if(await disclosure.count()&&await disclosure.getAttribute('open')===null)await disclosure.locator('summary').first().click();const id=await field.getAttribute('id'),index=await field.evaluate((s,wanted)=>[...s.options].findIndex(o=>o.value===wanted),value);if(index<0)throw Error('No matching visible choice');await page.locator('[data-chooser-for="'+id+'"]').click();await page.locator('.dk-choice-menu:not(.closing) [data-index="'+index+'"]').click();}
