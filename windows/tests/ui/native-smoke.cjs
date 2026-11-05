'use strict';
// Actual development Electron source. Only fresh synthetic wallets; no signing or broadcast. Public market reads may occur; no wallet RPC is configured.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {existsSync}=require('node:fs');
const {randomUUID,createHash}=require('node:crypto'),{createRequire}=require('node:module');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),execFileAsync=promisify(execFile);
const localCandidate=path.resolve(__dirname,'../..'),insideCandidate=existsSync(path.join(localCandidate,'main.cjs'));
const root=process.env.DRIVEKEY_UI_WORKSPACE?path.resolve(process.env.DRIVEKEY_UI_WORKSPACE):insideCandidate?path.resolve(localCandidate,'../..'):localCandidate;
const candidate=process.env.DRIVEKEY_UI_CANDIDATE?path.resolve(process.env.DRIVEKEY_UI_CANDIDATE):insideCandidate?localCandidate:path.join(root,'work/ui-redesign-candidate');
const moduleRoot=process.env.DRIVEKEY_BUILD_MODULES?path.resolve(process.env.DRIVEKEY_BUILD_MODULES):existsSync(path.join(candidate,'node_modules'))?candidate:path.join(root,'work/dependency-clean-candidate');
const dependencies=createRequire(path.join(moduleRoot,'package.json'));
const {_electron}=dependencies('@playwright/test'),jsQR=dependencies('jsqr');
const electron=path.join(path.dirname(dependencies.resolve('electron/package.json')),'dist/electron.exe'),nodeExe=process.execPath;
const output=process.env.DRIVEKEY_UI_OUTPUT?path.resolve(process.env.DRIVEKEY_UI_OUTPUT):insideCandidate?path.join(candidate,'verification/ui'):path.join(root,'outputs/ui-redesign-verification');
const runsBase=process.env.DRIVEKEY_UI_RUNS?path.resolve(process.env.DRIVEKEY_UI_RUNS):insideCandidate?path.join(candidate,'verification/runs'):path.join(root,'work/ui-verification/runs');
const runRoot=path.join(runsBase,'native-'+Date.now()+'-'+randomUUID());
const passphrase='Native fixture only '+randomUUID();
const results=[],errors=[],network=[],screenshots=[],apps=[];
let app,page,mode,clipboardDiagnostic;
const sourceFiles=['main.cjs','preload.cjs','ui-routes-main.cjs','ui/index.html','ui/shell.js','ui/routes.js','ui/style.css','ui/black.css','ui/chooser.js','ui/chooser.css','ui/portfolio.js','ui/workspace.js','ui/assets.js'];
const sourceHashes={};
async function record(name,fn,continueAfterFailure=false){try{const evidence=await fn();results.push({name,passed:true,evidence});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:String(e.message).slice(0,1600)});console.log('FAIL '+name+': '+String(e.message).slice(0,1200));if(!continueAfterFailure)throw e;if(page&&!page.isClosed())await screenshot(mode+'-'+name+'-failure-'+path.basename(runRoot)).catch(()=>{});}}
async function idle(){await page.waitForFunction(()=>document.querySelector('#working')?.hidden===true);await page.waitForTimeout(80);}
async function navigate(name){if(name==='signatures'&&await page.locator('[data-view="signatures"]:visible').count()===0)await navigate('review');const control=page.locator('[data-view="'+name+'"]:visible').first();assert.ok(await control.count(),'No visible navigation to '+name);await control.click();await page.locator('[data-page="'+name+'"]:visible').waitFor();await idle();}
async function queue(kind,value){await app.evaluate((_electron,{kind,value})=>{global.nativeSmokeAnswers[kind].push(value);},{kind,value});}
async function api(method,...args){return page.evaluate(({method,args})=>window.drivekey[method](...args),{method,args});}
async function size(width,height,zoom=1){
  await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());w.setContentSize(width,height);w.webContents.setZoomFactor(zoom);},{width,height,zoom});
  await page.waitForTimeout(180);
  const actual=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {content:w.getContentBounds(),zoom:w.webContents.getZoomFactor()};});
  assert.equal(actual.zoom,zoom);return actual;
}
async function screenshot(name){
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const file='native-'+name+'.png';const bytes=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));await fs.writeFile(path.join(output,file),Buffer.from(bytes,'base64'));screenshots.push(file);
}
async function decoded(selector){
  const pixels=await page.locator(selector).evaluate(async img=>{await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);return {width:canvas.width,height:canvas.height,data:Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)};});
  const value=jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height);assert.ok(value,'QR must decode independently');return value.data;
}
async function launch(offline=false,profileName){
  mode=offline?'offline':'online';const profile=path.join(runRoot,profileName||mode,'profile');
  await fs.mkdir(profile,{recursive:true});assert.ok(profile.startsWith(runRoot+path.sep));
  const temp=path.join(runRoot,'temp');await fs.mkdir(temp,{recursive:true});
  const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:temp,TMP:temp,PATH:path.dirname(nodeExe)+';'+path.join(process.env.SystemRoot,'System32'),DRIVEKEY_NODE:nodeExe};
  if(offline)env.DRIVEKEY_OFFLINE='1';
  app=await _electron.launch({executablePath:electron,args:[candidate,'--user-data-dir='+profile],env,cwd:candidate,timeout:45000});apps.push(app);
  const userData=await app.evaluate(({app})=>app.getPath('userData'));assert.equal(path.resolve(userData),path.resolve(profile),'Profile isolation before any wallet operation');
  await app.evaluate(({dialog,clipboard})=>{
    global.nativeSmokeAnswers={open:[],save:[],confirm:[]};global.nativeSmokeDialogs=[];
    global.nativeSmokeClipboardWrites=[];const write=clipboard.writeText.bind(clipboard);clipboard.writeText=(value,...rest)=>{global.nativeSmokeClipboardWrites.push(value);return write(value,...rest);};
    dialog.showOpenDialog=async(_w,options)=>{global.nativeSmokeDialogs.push({kind:'open',title:options.title});if(!global.nativeSmokeAnswers.open.length)throw Error('Unqueued test file picker');const file=global.nativeSmokeAnswers.open.shift();return file===null?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[file]};};
    dialog.showSaveDialog=async(_w,options)=>{global.nativeSmokeDialogs.push({kind:'save',title:options.title});if(!global.nativeSmokeAnswers.save.length)throw Error('Unqueued test save picker');const file=global.nativeSmokeAnswers.save.shift();return file===null?{canceled:true}:{canceled:false,filePath:file};};
    dialog.showMessageBox=async(_w,options)=>{global.nativeSmokeDialogs.push({kind:'confirm',title:options.title,defaultId:options.defaultId});if(!global.nativeSmokeAnswers.confirm.length)throw Error('Unqueued test confirmation');return {response:global.nativeSmokeAnswers.confirm.shift()};};
  });
  page=await app.firstWindow();page.on('pageerror',e=>errors.push({mode,message:e.message}));page.on('request',r=>{if(/^https?:/i.test(r.url()))network.push({mode,url:r.url()});});
  await page.waitForFunction(()=>document.body.dataset.ready==='true',{},{timeout:45000});
  await page.evaluate(()=>{const banner=document.createElement('div');banner.textContent='NATIVE UI · SYNTHETIC WALLET · NO LIVE TRANSACTIONS';banner.id='native-test-provenance';Object.assign(banner.style,{position:'fixed',bottom:'2px',left:'50%',transform:'translateX(-50%)',padding:'3px 8px',fontSize:'10px',background:'#08101e',color:'#f1c481',zIndex:'2147483647',pointerEvents:'none',borderRadius:'4px'});document.body.append(banner);});
  await size(1440,1000);return {mode,profileVerified:true};
}
async function createWallet(name,folder){
  await navigate('vault');await page.click('#new-wallet');await page.fill('#new-wallet-name',name);await page.fill('#new-pass',passphrase);await page.fill('#confirm-pass',passphrase);
  const vault=path.join(runRoot,folder+'-vault.json');await queue('save',vault);await page.locator('#create-form button[type=submit]').click();await idle();
  await page.locator('.wallet-row').first().waitFor();assert.ok((await fs.stat(vault)).size>0);assert.equal(await page.inputValue('#new-pass'),'');assert.equal(await page.inputValue('#confirm-pass'),'');return vault;
}
async function verifyBackup(folder){
  await navigate('security');const backup=path.join(runRoot,folder+'-backup.json');await queue('save',backup);await page.click('#backup');await idle();assert.ok((await fs.stat(backup)).size>0);
  await queue('open',backup);await page.fill('#backup-pass',passphrase);await page.locator('#backup-form button[type=submit]').click();await idle();
  assert.match(await page.textContent('#backup-state'),/verified.*session|verified/i);assert.equal(await page.inputValue('#backup-pass'),'');return {separateBackup:true,verified:true};
}
async function noOverflow(name){const v=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(v.scroll<=v.viewport+1,name+': '+JSON.stringify(v));return v;}
async function clipboardProbe(){
 const sentinel='DriveKey synthetic clipboard check '+randomUUID();
 const result=await app.evaluate(async({clipboard,ClipboardItem,BrowserWindow},sentinel)=>{
  const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();
  await clipboard.writeText(sentinel);const first=await clipboard.readText(),has=await clipboard.has('text/plain');
  const entries=await clipboard.read();const types=entries.flatMap(e=>e.types);
  await clipboard.write([new ClipboardItem({'text/plain':sentinel})]);const second=await clipboard.readText();
  return {focused:w.isFocused(),writeTextReadMatches:first===sentinel,writeTextReadLength:first.length,hasPlain:has,types,itemWriteReadMatches:second===sentinel,itemWriteReadLength:second.length};
 },sentinel);
 assert.match(sentinel,/^[A-Za-z0-9 -]+$/);
 const command="$value=Get-Clipboard -Raw; [pscustomobject]@{matches=($value -eq '"+sentinel+"'); length=([string]$value).Length} | ConvertTo-Json -Compress";
 const os=await execFileAsync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-Command',command],{windowsHide:true});result.osRead=JSON.parse(os.stdout.trim());
 const osWriteCommand="Set-Clipboard -Value '"+sentinel+"'; $value=Get-Clipboard -Raw; [pscustomobject]@{matches=($value -eq '"+sentinel+"'); length=([string]$value).Length} | ConvertTo-Json -Compress";
 const osWrite=await execFileAsync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-STA','-Command',osWriteCommand],{windowsHide:true});result.osWriteRead=JSON.parse(osWrite.stdout.trim());
 result.electronReadAfterOsWrite=await app.evaluate(async({clipboard},sentinel)=>{const value=await clipboard.readText();return {matches:value===sentinel,length:value.length};},sentinel);
 clipboardDiagnostic=result;return result;
}

(async()=>{
 await fs.mkdir(output,{recursive:true});await fs.mkdir(runRoot,{recursive:true});
 for(const file of sourceFiles)sourceHashes[file]=createHash('sha256').update(await fs.readFile(path.join(candidate,file))).digest('hex');
 try{
  await record('online-isolated-startup',()=>launch());
  await record('native-clipboard-diagnostic',clipboardProbe,true);
  await record('renderer-isolation-and-CSP',async()=>{assert.equal(await app.evaluate(({app})=>app.commandLine.hasSwitch('disable-lcd-text')),true);assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return true;}catch{return false;}}),false);return {nodeUnavailable:true,remoteFetchDenied:true};});
  let vault;await record('native-create-wallet-via-UI',async()=>{vault=await createWallet('Synthetic native wallet','online');return {walletCreated:true,secretInputsCleared:true};});
  await record('native-separate-backup-via-UI',()=>verifyBackup('online'));
  await record('native-address-QR-and-truthful-copy-outcome',async()=>{await navigate('receive');await choose(page,'#receive-network','ethereum');await idle();await page.locator('#receive-qr:visible').waitFor();const address=(await page.textContent('#receive-address')).trim();assert.match(address,/^0x[0-9a-fA-F]{40}$/);assert.equal(await decoded('#receive-qr'),'ethereum:'+address+'@1');await page.click('#copy-address');await idle();const copied=await app.evaluate(async({clipboard})=>({text:await clipboard.readText(),writes:global.nativeSmokeClipboardWrites}));assert.equal(copied.writes.at(-1),address,'Native clipboard write must receive exact public address');if(copied.text===address)return {network:'Ethereum',decodedMatchesReceiveUri:true,clipboardCapability:'available',copyMatches:true};assert.ok(clipboardDiagnostic&&!clipboardDiagnostic.writeTextReadMatches&&!clipboardDiagnostic.itemWriteReadMatches&&!clipboardDiagnostic.osWriteRead.matches,'Copy failure needs independently demonstrated host limitation');const message=await page.textContent('#toast-message');assert.match(message,/clipboard unavailable/i);assert.doesNotMatch(message,/address copied/i);return {network:'Ethereum',decodedMatchesReceiveUri:true,clipboardCapability:'blocked-by-host',copyIntegrationPassed:false,truthfulFailureStateVerified:true};},true);
  await record('native-solana-address-QR',async()=>{await choose(page,'#receive-network','solana');await idle();const address=(await page.textContent('#receive-address')).trim();assert.match(address,/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);assert.equal(await decoded('#receive-qr'),'solana:'+address);return {network:'Solana',decodedMatchesReceiveUri:true};});
  await record('native-exact-amount-QR',async()=>{await page.click('[data-receive-tab=request]');await choose(page,'#qr-chain','sepolia');await choose(page,'#qr-asset','USDC');await page.fill('#qr-amount','1.25');await page.locator('#qr-form button[type=submit]').click();await idle();await page.locator('#amount-qr:visible').waitFor();const uri=(await page.textContent('#qr-uri')).trim();assert.match(uri,/uint256=1250000/);assert.equal(await decoded('#amount-qr'),uri);return {chain:'Sepolia',asset:'USDC',baseUnits:'1250000',independentlyDecoded:true};});
  await record('native-deferred-transaction-navigation-closed',async()=>{
   const before=await page.evaluate(()=>window.DK.context().page);
   for(const name of ['swap','private']){
    assert.equal(await page.locator('.nav-item[data-view="'+name+'"]:visible').count(),0,name);
    await page.evaluate(name=>document.querySelector('[data-view="'+name+'"]').click(),name);
    assert.equal(await page.evaluate(()=>window.DK.context().page),before,'Hidden route must stay inaccessible: '+name);
   }
   return {deferred:['swap','private'],visibleNavigation:false,programmaticNavigationDenied:true};
  });
  const pages=['home','vault','payments','receive','activity','review','signatures','security','settings'];
  await record('native-all-online-tabs-and-local-assets',async()=>{for(const name of pages){await navigate(name);assert.ok((await page.locator('[data-page="'+name+'"] h1').innerText()).trim());await noOverflow(name);}await page.evaluate(()=>Promise.all([...document.images].filter(i=>i.getAttribute('src')).map(i=>i.decode().catch(()=>{}))));const broken=await page.evaluate(()=>[...document.images].filter(i=>i.getAttribute('src')&&(!i.complete||i.naturalWidth===0)).map(i=>i.getAttribute('src')));assert.deepEqual(broken,[]);return {tabs:pages,brokenImages:broken};});
  await record('native-online-desktop-capture',async()=>{await navigate('home');const physical=await size(1440,1000);await screenshot('online-overview-1440');await navigate('receive');await page.click('[data-receive-tab=request]');await screenshot('online-amount-QR-1440');return physical;});
  await record('native-online-850-layout',async()=>{await size(850,650);for(const name of pages){await navigate(name);await noOverflow(name);}await navigate('vault');await screenshot('online-wallets-850');return {content:[850,650]};},true);
  await record('native-online-actual-200-percent-zoom',async()=>{const physical=await size(1440,1000,2);for(const name of pages){await navigate(name);await noOverflow(name);}await navigate('review');await screenshot('online-review-zoom200');return physical;},true);
  await record('native-keyboard-focus',async()=>{await size(1440,1000);await navigate('settings');await page.keyboard.press('Tab');const focused=await page.evaluate(()=>({tag:document.activeElement.tagName,name:document.activeElement.getAttribute('aria-label')||document.activeElement.textContent?.trim()}));assert.notEqual(focused.tag,'BODY');return focused;});
  await record('native-clear-and-reopen-preserves-wallet',async()=>{await page.click('#lock');await idle();assert.match(await page.textContent('#vault-pill'),/choose|wallet/i);await navigate('vault');assert.equal(await page.locator('.wallet-row').count(),1);await queue('open',vault);await page.click('#add-wallet-file');await idle();assert.match(await page.textContent('#vault-pill'),/Synthetic native wallet/);assert.match(await page.textContent('#backup-state'),/not verified|verify|verification/i);return {walletFilePreserved:true,backupSessionReset:true};});
  await app.close();app=null;
  await record('offline-isolated-startup',()=>launch(true));
  await record('offline-wallet-create-via-UI',async()=>{await createWallet('Synthetic offline wallet','offline');return {walletCreated:true};});
  await record('offline-backup-via-UI',()=>verifyBackup('offline'));
  await record('offline-navigation-gating',async()=>{const allowed=['review','vault','signatures','security','settings'];for(const name of allowed){await navigate(name);await noOverflow(name);}for(const name of ['home','payments','receive','swap','private','activity'])assert.equal(await page.locator('.nav-item[data-view="'+name+'"]:visible').count(),0,name);return {allowed};});
  await record('offline-native-API-denials',async()=>{const denials=[];for(const method of ['configureRPC','paymentBalance','preparePayment','prepareSwap','prepareLifiEvm','prepareLifiSolana','prepareLifiMayanEvmSource','prepareMayanSolanaSource','prepareMayanEvmRedeem','prepareLifiRelaySolana','prepareLifiRelayEvm','prepareHinkal','prepareHinkalSolana','prepareHinkalSolanaSpend','prepareHinkalEvmSwap','prepareHinkalSolanaSwap','hinkalDiscover','openWeb']){const result=method==='openWeb'?await api(method,'swap','lifi'):await api(method,method==='paymentBalance'?{chain:'sepolia',asset:'ETH'}:{});assert.equal(result.ok,false,method);assert.match(result.error,['configureRPC','paymentBalance','preparePayment','openWeb'].includes(method)?/offline|networking|external links/i:/offline|networking|external links|direct ETH, SOL and USDC payments/i,method+': '+result.error);denials.push(method);}return {methods:denials};});
  await record('offline-native-screenshots',async()=>{await size(1440,1000);await navigate('review');await screenshot('offline-review-1440');await size(850,650);await navigate('security');await screenshot('offline-security-850');await size(1440,1000,2);for(const name of ['review','vault','signatures','security','settings']){await navigate(name);await noOverflow(name);}await navigate('review');await screenshot('offline-review-zoom200');return {actualZoom:2};},true);
  await record('no-renderer-errors-or-remote-requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);return {errors:0,remoteRequests:0};});
 }catch(error){if(page&&!page.isClosed())await screenshot(mode+'-failure').catch(()=>{});process.exitCode=1;}
 finally{
  for(const handle of apps)await handle.close().catch(()=>{});
  const sourceHashesAfter={};for(const file of sourceFiles)sourceHashesAfter[file]=createHash('sha256').update(await fs.readFile(path.join(candidate,file))).digest('hex');const sourceStable=JSON.stringify(sourceHashes)===JSON.stringify(sourceHashesAfter);
  const screenshotEvidence=[];for(const file of screenshots){const bytes=await fs.readFile(path.join(output,file));screenshotEvidence.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),capture:'Electron webContents.capturePage'});}
  const clipboardAvailable=Boolean(clipboardDiagnostic?.writeTextReadMatches||clipboardDiagnostic?.itemWriteReadMatches||clipboardDiagnostic?.osWriteRead?.matches);
  const report={passed:results.length>0&&results.every(r=>r.passed)&&sourceStable,scope:'Actual development Electron source; real Windows encrypted vault and backup workers; native file dialogs replaced only inside this isolated test process',createdAt:new Date().toISOString(),runDirectory:runRoot,sourceHashes,sourceHashesAfter,sourceStable,results,errors,remoteRendererRequests:network,screenshots:screenshotEvidence,capabilities:{clipboard:{status:clipboardAvailable?'available':'blocked-by-host',integrationPassed:clipboardAvailable,diagnostic:clipboardDiagnostic},qr:'real local encoder independently decoded'},syntheticWallets:true,signaturesCreated:0,broadcasts:0,liveFundsSpent:0};
  report.allCapabilitiesVerified=report.passed&&clipboardAvailable;report.status=report.passed?(clipboardAvailable?'passed':'checks-pass-with-external-clipboard-blocker'):'failed';
  if(!report.passed)process.exitCode=1;else if(!report.allCapabilitiesVerified)process.exitCode=2;
  const json=JSON.stringify(report,null,2)+'\n';await fs.writeFile(path.join(output,path.basename(runRoot)+'-report.json'),json);await fs.writeFile(path.join(output,'NATIVE-SMOKE.json'),json);console.log(JSON.stringify({passed:report.passed,status:report.status,allCapabilitiesVerified:report.allCapabilitiesVerified,checks:results.length,failed:results.filter(r=>!r.passed).map(r=>r.name),screenshots}));
 }
})().catch(error=>{console.error(String(error.message).slice(0,1500));process.exitCode=1;});

async function choose(page,selector,value){const field=page.locator(selector);const disclosure=field.locator('xpath=ancestor::details[1]');if(await disclosure.count()&&await disclosure.getAttribute('open')===null)await disclosure.locator('summary').first().click();const id=await field.getAttribute('id'),index=await field.evaluate((s,wanted)=>[...s.options].findIndex(o=>o.value===wanted),value);if(index<0)throw Error('No matching visible choice');await page.locator('[data-chooser-for="'+id+'"]').click();await page.locator('.dk-choice-menu:not(.closing) [data-index="'+index+'"]').click();}
