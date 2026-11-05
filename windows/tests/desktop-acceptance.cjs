const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const dependencyRoot=process.env.DRIVEKEY_BUILD_MODULES||root;
const deps=createRequire(path.join(dependencyRoot,'package.json'));
const {_electron}=deps('@playwright/test');
const {Transaction,Wallet}=deps('ethers');
const {randomUUID}=require('node:crypto');
const {createTestPaths,captureScreen}=require('./test-output.cjs');
const {scratch,output}=createTestPaths('desktop-acceptance');
async function main(){
 await fs.mkdir(scratch,{recursive:true});
 const app=await _electron.launch({executablePath:path.join(root,'portable','DriveKey Connect Preview.exe'),args:['--user-data-dir='+path.join(scratch,'profile')],timeout:30000});
 try{
 const page=await app.firstWindow();await page.waitForSelector('#start');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 const runtime=await app.evaluate(({BrowserWindow})=>({electron:process.versions.electron,node:process.versions.node,visible:BrowserWindow.getAllWindows()[0].isVisible()}));assert.equal(runtime.visible,true);assert.equal(runtime.electron,deps('electron/package.json').version,'Bundled Electron must match the locked security-patched dependency');
 for(const f of ['main.cjs','preload.cjs','wallet-store.cjs','package.json','ui/index.html','ui/app.js','ui/style.css','ui/assets/usb-pcb-hero.png','ui/assets/usb-pcb-detail.png','ui/assets/drivekey-logo.jpg','ui/assets/solana.png','ui/assets/hinkal.svg','web-links.cjs','dist/receive.cjs','ui/assets/Inter.woff2','ui/assets/SpaceGrotesk.woff2','dist/worker.cjs'])assert.deepEqual(await fs.readFile(path.join(root,f)),await fs.readFile(path.join(root,'portable','resources','app',f)));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await fs.mkdir(output,{recursive:true});
 const capture=async name=>{await page.locator('#toast').waitFor({state:'hidden',timeout:12000});await captureScreen(page,path.join(output,name));};
 await page.waitForSelector('.update-card');await capture('03-overview.png');
 assert.equal(await page.locator('.product-art img').evaluate(img=>img.complete&&img.naturalWidth===1200),true);
 assert.equal(await page.evaluate(()=>document.fonts.check('500 14px Inter')&&document.fonts.check('500 14px '+JSON.stringify('Space Grotesk'))),true);
 await captureScreen(page,path.join(output,'preview.png'));
 // Dialog substitution is scoped to this acceptance process. Production dialogs remain native.
 await app.evaluate(({dialog})=>{global.__answers={open:[],save:[],confirm:[]};global.__lastConfirm=null;dialog.showSaveDialog=async()=>{const file=global.__answers.save.shift();if(file===undefined)throw Error('Unexpected save picker');return file===null?{canceled:true}:{canceled:false,filePath:file};};dialog.showOpenDialog=async()=>{const file=global.__answers.open.shift();if(file===undefined)throw Error('Unexpected open picker');return file===null?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[file]};};dialog.showMessageBox=async(_window,options)=>{global.__lastConfirm=options;return {response:global.__answers.confirm.shift()??0};};});
 const queue=(type,file)=>app.evaluate((_,{type,file})=>global.__answers[type].push(file),{type,file});
 const pass='disposable acceptance passphrase 8237';
 const vault=path.join(scratch,'vault-'+Date.now()+'.json'),backup=vault+'.backup.json',pub=vault+'.public.json',request=vault+'.request.json',signed=vault+'.signed.json';
 await page.click('#start');await capture('04-vault-setup.png');await page.fill('#new-pass',pass);await page.fill('#confirm-pass',pass);await queue('save',vault);await page.click('#create-form button');await page.waitForSelector('#vault-loaded:not([hidden])');
 assert.equal(await page.inputValue('#new-pass'),'');
 await queue('save',pub);await page.click('#public');await page.waitForFunction(()=>document.querySelector('#working').hidden);
 await queue('save',backup);await page.click('#backup');await page.waitForFunction(()=>document.querySelector('#working').hidden);
 await queue('open',vault);await page.fill('#backup-pass',pass);await page.click('#backup-form button');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.match(await page.textContent('#toast'),/separate backup/);
 await queue('open',backup);await page.fill('#backup-pass','incorrect disposable passphrase');await page.click('#backup-form button');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.match(await page.textContent('#toast'),/Incorrect passphrase|damaged/);
 await queue('open',backup);await page.fill('#backup-pass',pass);await page.click('#backup-form button');await page.waitForFunction(()=>document.querySelector('#backup-state').textContent==='Backup verified');
 await capture('05-vault-and-backup.png');
 const beforeCancel=(await page.evaluate(()=>window.drivekey.listWallets())).result;
 const cancelledPickers=[];
 await page.click('#new-wallet');await page.fill('#new-wallet-name','Cancelled wallet');await page.fill('#new-pass',pass);await page.fill('#confirm-pass',pass);await queue('save',null);await page.click('#create-form button');await page.waitForFunction(()=>document.querySelector('#working').hidden);
 let afterCancel=(await page.evaluate(()=>window.drivekey.listWallets())).result;assert.equal(afterCancel.activeId,beforeCancel.activeId);assert.equal(afterCancel.wallets.length,beforeCancel.wallets.length);assert.equal(await page.inputValue('#new-pass'),'');await page.click('#cancel-new-wallet');cancelledPickers.push('Canceled new-wallet save preserves the active wallet and catalog');
 await queue('open',null);await page.click('#add-wallet-file');await page.waitForFunction(()=>document.querySelector('#working').hidden);afterCancel=(await page.evaluate(()=>window.drivekey.listWallets())).result;assert.equal(afterCancel.activeId,beforeCancel.activeId);assert.equal(afterCancel.wallets.length,beforeCancel.wallets.length);cancelledPickers.push('Canceled open-file picker preserves selection and catalog');
 await queue('save',null);await page.click('#backup');await page.waitForFunction(()=>document.querySelector('#working').hidden);await queue('open',null);await page.fill('#backup-pass',pass);await page.click('#backup-form button');await page.waitForFunction(()=>document.querySelector('#working').hidden);afterCancel=(await page.evaluate(()=>window.drivekey.listWallets())).result;assert.equal(afterCancel.activeId,beforeCancel.activeId);assert.equal(afterCancel.wallets.find(item=>item.active).backupVerified,true);assert.equal(await page.inputValue('#backup-pass'),'');assert.equal(await page.textContent('#backup-state'),'Backup verified');cancelledPickers.push('Canceled backup save and verification preserve existing verification and clear the passphrase field');
 const wallet=JSON.parse(await fs.readFile(pub,'utf8'));
 // Exercise the real main IPC boundary while keeping the system browser and
 // clipboard untouched by disposable fixture actions.
 await app.evaluate(({shell,clipboard})=>{global.__opened=[];global.__copied=null;shell.openExternal=async url=>{global.__opened.push(url);};clipboard.writeText=value=>{global.__copied=value;};});
 await page.click('[data-view=receive]');await page.waitForFunction(()=>!document.querySelector('#receive-qr').hidden);
 assert.equal(await page.textContent('#receive-address'),wallet.evmAddress);
 assert.equal(await page.locator('#receive-qr').evaluate(img=>img.complete&&img.naturalWidth===256),true);
 await capture('10-deposit-ethereum.png');
 await page.selectOption('#receive-network','solana');await page.waitForFunction(expected=>document.querySelector('#receive-address').textContent===expected,wallet.solanaAddress);
 await page.click('#copy-address');await page.waitForFunction(()=>document.querySelector('#working').hidden);
 assert.equal(await app.evaluate(()=>global.__copied),wallet.solanaAddress);await capture('11-deposit-solana.png');
 await page.click('[data-view=swap]');assert.equal(await page.locator('[data-web-route=swap]').isDisabled(),true);await page.click('[data-provider=jupiter]');assert.equal(await page.locator('[data-web-route=swap]').isDisabled(),true);await page.click('[data-chain=solana]');await capture('12-swap.png');
 await page.click('[data-web-route=swap]');await page.waitForFunction(()=>document.querySelector('#working').hidden);
 assert.equal(await app.evaluate(()=>global.__opened.at(-1)),'https://drivekey.info/app/swap?provider=jupiter');
 await page.click('[data-view=private]');await capture('13-hinkal.png');
 for(const route of ['hinkal-pay','hinkal-swap','hinkal-deposit']){await page.click('[data-web-route='+route+']');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.equal(await app.evaluate(()=>global.__opened.at(-1)),'https://drivekey.info/app/hinkal');}
 await page.click('[data-view=savings]');await page.check('input[name=protection-mode][value=strong]');await capture('14-savings.png');
 await page.click('[data-web-route=savings]');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.equal(await app.evaluate(()=>global.__opened.at(-1)),'https://drivekey.info/app/savings');assert.match(await page.textContent('#toast'),/Strong/);
 await page.check('input[name=protection-mode][value=standard]');await page.click('[data-web-route=savings]');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.equal(await app.evaluate(()=>global.__opened.at(-1)),'https://drivekey.info/app/savings');assert.match(await page.textContent('#toast'),/Standard/);
 await page.click('[data-view=home]');await page.click('[data-web-route=send]');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.equal(await app.evaluate(()=>global.__opened.at(-1)),'https://drivekey.info/app/send');assert.equal(await page.locator('.update-card').count(),3);
 for(const [article,status]of [['workflow','2115948449107525758'],['roadmap','2115915967306035454'],['hardware','2115432116410634344']]){await page.click('[data-article-id='+article+']');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.equal(await app.evaluate(()=>global.__opened.at(-1)),'https://x.com/DriveKeyyy/status/'+status);}
 const invalid=await page.evaluate(()=>window.drivekey.openWeb('swap','https://evil.example'));assert.equal(invalid.ok,false);
 await page.click('[data-view=vault]');
 // Use the actual exported public identity and actual request fingerprint implementation.
 const engine=deps('esbuild');const compiled=await engine.build({absWorkingDir:root,stdin:{contents:"export {tradeFingerprint,verifyTradeResponse} from './engine/core/trade-protocol';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',nodePaths:[path.join(dependencyRoot,'node_modules')],write:false});
 const temp=path.join(scratch,'protocol.cjs');await fs.writeFile(temp,compiled.outputFiles[0].contents);const {tradeFingerprint,verifyTradeResponse}=require(temp);
 const now=Math.floor(Date.now()/1000)*1000;
 const to=Wallet.createRandom().address;
 const tx=Transaction.from({type:2,chainId:1,nonce:0,to,value:1000000000000n,data:'0x',gasLimit:21000,maxFeePerGas:1000000000,maxPriorityFeePerGas:1000000});
 const r={version:4,network:'ethereum',chainId:1,kind:'payment',requestId:randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+20*60000).toISOString(),from:wallet.evmAddress,recipient:to,tokenIn:'ETH',tokenOut:null,amount:tx.value.toString(),minimumOutput:'0',quotedOutput:'0',slippageBps:0,poolFee:500,unsignedTransaction:tx.unsignedSerialized};r.fingerprint=tradeFingerprint(r);await fs.writeFile(request,JSON.stringify(r));
 await page.click('#go-review');await queue('open',request);await page.click('#import');await page.waitForSelector('#review-loaded:not([hidden])');assert.match(await page.textContent('#terms'),new RegExp(to));await capture('06-transaction-review.png');
 await page.check('#approval');await page.fill('#sign-pass',pass);await queue('confirm',0);await page.click('#sign-form button');await page.waitForFunction(()=>document.querySelector('#working').hidden);assert.match(await page.textContent('#toast'),/cancelled/);await assert.rejects(fs.stat(signed));
 // Consuming approval and canceling export must never leave a reusable token.
 await queue('open',request);const exportReview=await page.evaluate(()=>window.drivekey.importRequest());assert.equal(exportReview.ok,true);
 await queue('confirm',1);await queue('save',null);const cancelledExport=await page.evaluate(({token,fingerprint,pass})=>window.drivekey.sign(token,fingerprint,pass),{token:exportReview.result.token,fingerprint:exportReview.result.review.fingerprint,pass});
 assert.equal(cancelledExport.ok,true);assert.equal(cancelledExport.result.saved,false);assert.equal(cancelledExport.result.reviewConsumed,true);assert.match(cancelledExport.result.warning,/export cancelled.*No broadcast/);await assert.rejects(fs.stat(signed));
 const replay=await page.evaluate(({token,fingerprint,pass})=>window.drivekey.sign(token,fingerprint,pass),{token:exportReview.result.token,fingerprint:exportReview.result.review.fingerprint,pass});assert.equal(replay.ok,false);assert.match(replay.error,/Review expired or changed/);
 await queue('open',request);const invalidated=await page.evaluate(()=>window.drivekey.importRequest());assert.equal(invalidated.ok,true);await queue('open',null);const importCancelled=await page.evaluate(()=>window.drivekey.importRequest());assert.equal(importCancelled.result.cancelled,true);
 const staleAfterCancel=await page.evaluate(({token,fingerprint,pass})=>window.drivekey.sign(token,fingerprint,pass),{token:invalidated.result.token,fingerprint:invalidated.result.review.fingerprint,pass});assert.equal(staleAfterCancel.ok,false);assert.match(staleAfterCancel.error,/Review expired or changed/);
 cancelledPickers.push('Canceled signature export creates no response file and consumes its review token; canceled request import invalidates the preceding review');
 const vaultBeforeOverwrite=await fs.readFile(vault);await queue('save',vault);const overwrite=await page.evaluate(()=>window.drivekey.exportPublic());assert.equal(overwrite.ok,false);assert.deepEqual(await fs.readFile(vault),vaultBeforeOverwrite);cancelledPickers.push('Export refuses to overwrite an existing encrypted vault and leaves its bytes intact');
 await queue('open',request);await page.click('#import');await page.waitForSelector('#review-loaded:not([hidden])');await page.check('#approval');await page.fill('#sign-pass',pass);await queue('confirm',1);await queue('save',signed);await page.click('#sign-form button');await page.waitForSelector('#signed:not([hidden])');
 await capture('07-signature-exported.png');
 const response=JSON.parse(await fs.readFile(signed,'utf8'));verifyTradeResponse(response,r,wallet);assert.equal(await page.inputValue('#sign-pass'),'');
 const native=await app.evaluate(()=>global.__lastConfirm);assert.equal(native.defaultId,0);assert.equal(native.cancelId,0);assert.match(native.detail,new RegExp(r.fingerprint));
 const isolation=await page.evaluate(()=>({node:typeof require,process:typeof process,api:Object.keys(window.drivekey).sort()}));assert.equal(isolation.node,'undefined');assert.equal(isolation.process,'undefined');assert.equal(isolation.api.length,19);
 const network=await page.evaluate(async()=>{try{await fetch('https://example.com');return 'allowed';}catch{return 'blocked';}});assert.equal(network,'blocked');
 const extra=await page.evaluate(()=>window.open('https://example.com'));assert.equal(extra,null);
 await page.click('#lock');await page.waitForSelector('[data-page=home]:not([hidden])');assert.equal(errors.length,0,errors.join('\n'));
 await page.click('[data-view=receive]');assert.equal(await page.textContent('#receive-address'),'—');assert.equal(await page.locator('#copy-address').isDisabled(),true);
 await page.setViewportSize({width:850,height:780});await page.click('[data-view=vault]');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await capture('08-compact-layout.png');
 const result={builtAt:new Date().toISOString(),cryptoEvidence:{scope:'Actual packaged Ethereum signature independently verified here. The separate crypto suite is measured by the release runner.'},desktop:{passed:true,packagedExecutable:true,runtime,dialogMode:'Automated native-dialog stubs. Main and renderer flow otherwise actual packaged app.',checks:['vault creation and encrypted file save','public identity export','separate encrypted backup save','same-file backup rejection','incorrect passphrase rejection','backup reopened and verified','exact transaction details rendered','default-cancel native confirmation terms','cancelled signing yields no response','actual packaged worker signs and exports response','exported signature independently verified','passphrase fields cleared','renderer Node/process unavailable','narrow IPC API','renderer HTTP fetch blocked','new window blocked','session cleared','850px layout has no horizontal overflow'],pageErrors:errors},limitations:['No broadcast or funded acceptance','No independent security audit','Same-host worker has no OS-enforced network isolation','Native dialogs stubbed for automated journey; separate visual inspection recorded','Windows x64 only; no iOS or Mac build']};
 result.websiteWorkflows={passed:true,systemBrowser:'Stubbed; exact real destination URLs asserted through actual main IPC',clipboard:'Stubbed; loaded Solana address asserted',receiveQR:'Actual PNG rendered in packaged UI; QR contents independently decoded in web-workflows.test.cjs',checked:['Ethereum and Solana receive identity','QR rendering','copy address','Jupiter provider handoff','Hinkal payment/swap/deposit instructions','Standard and Strong Savings setup handoffs and matching hints','Send website handoff','All three fixed X update links','arbitrary URL rejection','receive identity cleared on session clear']};
 result.cancelledPickerChecks=cancelledPickers;
 await fs.writeFile(path.join(output,'DESKTOP-TEST-RESULTS.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 if(process.env.KEEP_PREVIEW_OPEN==='1'){console.log('Preview left open for visual inspection.');await new Promise(()=>{});}else return;
 }finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
