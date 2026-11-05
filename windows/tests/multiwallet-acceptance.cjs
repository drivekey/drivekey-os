// Actual packaged multiwallet manager. Native dialogs are substituted only in
// this isolated acceptance process; no funds, network, or user's catalog is used.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),dependencyRoot=process.env.DRIVEKEY_BUILD_MODULES||root;
const deps=createRequire(path.join(dependencyRoot,'package.json'));
const {_electron}=deps('@playwright/test'),{Transaction,Wallet}=deps('ethers');
const {createTestPaths,captureScreen}=require('./test-output.cjs');
const {scratch,output}=createTestPaths('multiwallet-acceptance'),profile=path.join(scratch,'profile');
const passA='disposable spending passphrase 8237',passB='disposable savings passphrase 4169';
const files={a:path.join(scratch,'spending.json'),b:path.join(scratch,'savings.json'),backup:path.join(scratch,'spending.backup.json'),publicA:path.join(scratch,'spending.public.json'),publicB:path.join(scratch,'savings.public.json'),request:path.join(scratch,'request.json'),signed:path.join(scratch,'signed.json')};
const errors=[],checks=[];let app,page;
const idle=()=>page.waitForFunction(()=>document.querySelector('#working').hidden);
const api=async(method,...args)=>{
 for(let attempt=0;attempt<60;attempt++){
  const r=await page.evaluate(async({method,args})=>window.drivekey[method](...args),{method,args});
  if(r.ok||!/Finish the current operation/.test(r.error||''))return r;
  await page.waitForTimeout(50);
 }
 throw Error('Main process stayed busy.');
};
const ok=async(method,...args)=>{const r=await api(method,...args);assert.equal(r.ok,true,r.error);return r.result;};
const queue=(type,value)=>app.evaluate((_,{type,value})=>global.__answers[type].push(value),{type,value});
const list=()=>ok('listWallets');
const row=id=>page.locator('[data-wallet-id="'+id+'"]');
async function start(){
 app=await _electron.launch({executablePath:path.join(root,'portable','DriveKey Connect Preview.exe'),args:['--user-data-dir='+profile],timeout:30000});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#start');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))).toLowerCase(),profile.toLowerCase(),'acceptance must use isolated profile');
 await app.evaluate(({dialog})=>{
  global.__answers={open:[],save:[],confirm:[]};global.__lastConfirm=null;
  dialog.showSaveDialog=async()=>{const filePath=global.__answers.save.shift();if(!filePath)throw Error('Unexpected save dialog');return {canceled:false,filePath};};
  dialog.showOpenDialog=async()=>{const filePath=global.__answers.open.shift();if(!filePath)throw Error('Unexpected open dialog');return {canceled:false,filePaths:[filePath]};};
  dialog.showMessageBox=async(_win,options)=>{global.__lastConfirm=options;return {response:global.__answers.confirm.shift()??0};};
 });
 await list();await idle();await page.click('[data-view=vault]');await page.waitForSelector('#new-wallet');
}
async function capture(name){
 await page.locator('#toast').waitFor({state:'hidden',timeout:12000});await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow');
 await captureScreen(page,path.join(output,name));
}
async function create(name,password,file){
 await page.click('[data-view=vault]');await page.click('#new-wallet');await page.fill('#new-wallet-name',name);
 await page.fill('#new-pass',password);await page.fill('#confirm-pass',password);await queue('save',file);await page.click('#create-form button[type=submit]');
 await page.waitForFunction(expected=>document.querySelector('#active-wallet-name').textContent===expected,name);await idle();
 assert.equal(await page.inputValue('#new-pass'),'');assert.equal(await page.inputValue('#confirm-pass'),'');
 const state=await list();return state.wallets.find(w=>w.active);
}
async function activate(wallet){
 await page.click('[data-view=vault]');
 if((await list()).activeId===wallet.id)return (await list()).wallets.find(w=>w.active);
 await row(wallet.id).locator('[data-wallet-action=activate]').click();
 await page.waitForFunction(expected=>document.querySelector('#active-wallet-name').textContent===expected,wallet.name);await idle();
 return (await list()).wallets.find(w=>w.active);
}
async function readPublic(file){await queue('save',file);await page.click('#public');await idle();return JSON.parse(await fs.readFile(file,'utf8'));}
async function compileProtocol(){
 const compiled=await deps('esbuild').build({absWorkingDir:root,stdin:{contents:"export {tradeFingerprint,verifyTradeResponse} from './engine/core/trade-protocol';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'cjs',nodePaths:[path.join(dependencyRoot,'node_modules')],write:false});
 const output=path.join(scratch,'protocol.cjs');await fs.writeFile(output,compiled.outputFiles[0].contents);return require(output);
}
(async()=>{
 await fs.mkdir(scratch,{recursive:true});await fs.mkdir(output,{recursive:true});
 try{
  await start();assert.equal((await list()).wallets.length,0);checks.push('Fresh isolated profile starts with an empty wallet catalog');
  for(const file of ['main.cjs','preload.cjs','wallet-store.cjs','ui/index.html','ui/app.js','ui/style.css'])assert.deepEqual(await fs.readFile(path.join(root,file)),await fs.readFile(path.join(root,'portable/resources/app',file)),file+' differs from package');
  const a=await create('Spending',passA,files.a),publicA=await readPublic(files.publicA);assert.ok(a.id);
  await queue('save',files.backup);await page.click('#backup');await idle();await queue('open',files.backup);await page.fill('#backup-pass',passA);await page.click('#backup-form button');await page.waitForFunction(()=>document.querySelector('#backup-state').textContent==='Backup verified');
  assert.equal((await list()).wallets.find(w=>w.id===a.id).backupVerified,true);
  await page.click('#new-wallet');assert.equal((await list()).activeId,a.id);await capture('23-wallet-create.png');await page.click('#cancel-new-wallet');assert.equal((await list()).activeId,a.id);
  const b=await create('Savings',passB,files.b),publicB=await readPublic(files.publicB);
  assert.notEqual(a.id,b.id);assert.notEqual(publicA.evmAddress,publicB.evmAddress);assert.notEqual(publicA.solanaAddress,publicB.solanaAddress);
  assert.equal((await list()).wallets.length,2);assert.equal((await list()).wallets.find(w=>w.id===b.id).backupVerified,false);checks.push('Two actual independently generated encrypted vaults have distinct EVM and Solana identities');
  await capture('20-multiwallets.png');
  let active=await activate(a);assert.equal(active.backupVerified,true);assert.equal(await page.textContent('#backup-state'),'Backup verified');
  await page.click('[data-view=receive]');await page.waitForFunction(expected=>document.querySelector('#receive-address').textContent===expected,publicA.evmAddress);
  active=await activate(b);assert.equal(active.backupVerified,false);await page.click('[data-view=receive]');await page.selectOption('#receive-network','solana');await page.waitForFunction(expected=>document.querySelector('#receive-address').textContent===expected,publicB.solanaAddress);
  await activate(a);await capture('21-wallet-switch.png');checks.push('Switching selects the correct public receive identity and keeps backup verification scoped to its wallet');
  const protocol=await compileProtocol(),now=Math.floor(Date.now()/1000)*1000,to=Wallet.createRandom().address;
  const tx=Transaction.from({type:2,chainId:1,nonce:0,to,value:1000000000000n,data:'0x',gasLimit:21000,maxFeePerGas:1000000000,maxPriorityFeePerGas:1000000});
  const request={version:4,network:'ethereum',chainId:1,kind:'payment',requestId:randomUUID(),deviceId:publicA.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+20*60000).toISOString(),from:publicA.evmAddress,recipient:to,tokenIn:'ETH',tokenOut:null,amount:tx.value.toString(),minimumOutput:'0',quotedOutput:'0',slippageBps:0,poolFee:500,unsignedTransaction:tx.unsignedSerialized};request.fingerprint=protocol.tradeFingerprint(request);await fs.writeFile(files.request,JSON.stringify(request));
  await queue('open',files.b);const wrongBackup=await api('verifyBackup',passB);assert.equal(wrongBackup.ok,false);assert.match(wrongBackup.error,/backup does not match/);assert.equal((await list()).wallets.find(w=>w.id===a.id).backupVerified,true);checks.push('Another wallet vault is rejected as a backup without changing the selected wallet verification');
  await queue('open',files.request);const reviewed=await ok('importRequest');await activate(b);await queue('open',files.request);const wrong=await api('importRequest');assert.equal(wrong.ok,false,'another wallet must reject this request');
  await activate(a);const stale=await api('sign',reviewed.token,reviewed.review.fingerprint,passA);assert.equal(stale.ok,false);assert.match(stale.error,/Review expired|changed|review/i);checks.push('Changing wallets invalidates the review token even after returning, and a request for another identity is rejected');
  await queue('open',files.request);const fresh=await ok('importRequest');await queue('confirm',1);await queue('save',files.signed);const signed=await ok('sign',fresh.token,fresh.review.fingerprint,passA);assert.equal(signed.saved,true);
  protocol.verifyTradeResponse(JSON.parse(await fs.readFile(files.signed,'utf8')),request,publicA);const native=await app.evaluate(()=>global.__lastConfirm);assert.equal(native.defaultId,0);assert.match(native.detail,new RegExp(request.fingerprint));checks.push('A newly reviewed request signs with the selected wallet and its actual exported signature verifies independently');
  await page.click('#go-review');await queue('open',files.request);await page.click('#import');await page.waitForSelector('#review-loaded:not([hidden])');await activate(b);assert.equal(await page.locator('#review-loaded').isHidden(),true);assert.equal(await page.inputValue('#sign-pass'),'');checks.push('Switching wallets clears the displayed review and passphrase fields');
  await page.click('[data-view=vault]');await row(a.id).locator('[data-wallet-action=rename]').click();const literal='Savings <vault> & travel';await row(a.id).locator('[data-wallet-name]').fill(literal);await row(a.id).locator('[data-wallet-action=save-name]').click();await idle();assert.equal((await list()).wallets.find(w=>w.id===a.id).name,literal);assert.equal(await row(a.id).locator('vault').count(),0);a.name=literal;
  await page.fill('#wallet-search','travel');assert.equal(await page.locator('[data-wallet-id]:visible').count(),1);await page.fill('#wallet-search','');checks.push('Rename renders as literal text and search finds the saved wallet name');
  await queue('open',files.a);await page.click('#add-wallet-file');await page.waitForFunction(expected=>document.querySelector('#active-wallet-name').textContent===expected,a.name);await idle();assert.equal((await list()).activeId,a.id);assert.equal((await list()).wallets.length,2);assert.equal((await list()).wallets.find(w=>w.id===a.id).backupVerified,true);
  await queue('open',files.backup);await page.click('#add-wallet-file');await idle();assert.equal((await list()).wallets.length,2);assert.equal((await list()).wallets.find(w=>w.id===a.id).backupVerified,false);
  await queue('open',files.a);await page.click('#add-wallet-file');await idle();await activate(b);checks.push('Opening the same vault deduplicates the catalog; relinking a backup copy resets verification for the new file reference');
  const originalA=await fs.readFile(files.a);await fs.rename(files.a,files.a+'.missing');const missing=await api('activateWallet',a.id);assert.equal(missing.ok,false);assert.equal((await list()).activeId,b.id);await fs.rename(files.a+'.missing',files.a);
  const damaged=JSON.parse(originalA);damaged.__acceptanceTamper=true;await fs.writeFile(files.a,JSON.stringify(damaged));const tampered=await api('activateWallet',a.id);assert.equal(tampered.ok,false);assert.equal((await list()).activeId,b.id);await fs.writeFile(files.a,originalA);checks.push('Missing or changed vault files fail activation without replacing the current wallet');
  const invalidName=await api('renameWallet',a.id,'bad\u0000name');assert.equal(invalidName.ok,false);
  const invalidId=await api('activateWallet','../../arbitrary.json');assert.equal(invalidId.ok,false);
  const state=await list();assert.equal(JSON.stringify(state).includes(scratch),false,'renderer must not receive vault paths');
  const jsonFiles=(await fs.readdir(profile)).filter(f=>f.endsWith('.json'));let catalog;
  for(const filename of jsonFiles){const text=await fs.readFile(path.join(profile,filename),'utf8');if(text.includes(a.id)&&text.includes(b.id)){catalog={filename,text};break;}}
  assert.ok(catalog,'persisted catalog file not found');assert.equal(catalog.text.includes(passA)||catalog.text.includes(passB),false);assert.equal(/ciphertext|privateKey|secretKey/.test(catalog.text),false);checks.push('Persistent catalog contains public metadata and file references, with no passphrases or encrypted key payload; renderer does not receive file paths');
  await page.setViewportSize({width:850,height:850});await capture('22-multiwallet-compact.png');await page.setViewportSize({width:1400,height:980});
  await page.click('#lock');await page.waitForFunction(()=>document.querySelector('#working').hidden);const cleared=await list();assert.equal(cleared.wallets.length,2);assert.equal(cleared.activeId==null,true);assert.ok(cleared.wallets.every(w=>!w.backupVerified));await page.click('[data-view=receive]');assert.equal(await page.textContent('#receive-address'),'—');assert.equal(await page.locator('#copy-address').isDisabled(),true);checks.push('Clear session retains catalog entries but clears active identity, receive QR, review and per-session backup verification');
  await app.close();app=null;await start();const restarted=await list();assert.equal(restarted.wallets.length,2);assert.equal(restarted.wallets.find(w=>w.id===a.id).name,literal);assert.equal(restarted.activeId==null,true);assert.ok(restarted.wallets.every(w=>!w.backupVerified));await activate(a);assert.equal((await list()).wallets.find(w=>w.id===a.id).backupVerified,false);checks.push('Restart keeps wallet names while requiring a new selection and fresh backup verification');
  await row(b.id).locator('[data-wallet-action=remove]').click();await row(b.id).locator('[data-wallet-action=cancel-edit]').click();assert.equal((await list()).wallets.length,2);
  await row(b.id).locator('[data-wallet-action=remove]').click();await row(b.id).locator('[data-wallet-action=confirm-remove]').click();await idle();assert.equal((await list()).wallets.length,1);assert.ok((await fs.stat(files.b)).isFile());
  await row(a.id).locator('[data-wallet-action=remove]').click();await row(a.id).locator('[data-wallet-action=confirm-remove]').click();await idle();const removed=await list();assert.equal(removed.wallets.length,0);assert.equal(removed.activeId==null,true);for(const file of [files.a,files.b,files.backup])assert.ok((await fs.stat(file)).isFile());checks.push('Removal is cancelable and removes only catalog references; original vaults and backups remain intact');
  const isolation=await page.evaluate(()=>({require:typeof require,process:typeof process,api:Object.keys(window.drivekey)}));assert.equal(isolation.require,'undefined');assert.equal(isolation.process,'undefined');assert.equal(isolation.api.length,19);assert.deepEqual(errors,[]);
  const report={checkedAt:new Date().toISOString(),passed:true,packagedExecutable:true,isolatedUserData:true,checks,dialogs:'Stubbed native pickers and confirmation; actual main IPC, encrypted vault worker, persisted catalog and renderer',signedResponse:'Actual selected-wallet signature independently verified',funds:'Disposable unfunded wallets; no broadcast or swap submitted',pageErrors:errors,screenshots:['20-multiwallets.png','21-wallet-switch.png','22-multiwallet-compact.png','23-wallet-create.png']};
  await fs.writeFile(path.join(output,'MULTIWALLET-TEST-RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
