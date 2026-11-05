// Exact production packages, renderer-only CDP. No main inspector, injected main
// hooks, network preparation, financial signatures or broadcasts are used.
import {chromium} from '@playwright/test';
import {getCurrentFuseWire,FuseV1Options,FuseState} from '@electron/fuses';
import {extractFile as nativeExtractFile,listPackage} from '@electron/asar';
import {readFile,writeFile,mkdir,access,cp} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fingerprint} from '../tools/fingerprint.mjs';
const extractFile=(archive,file)=>nativeExtractFile(archive,file.replaceAll('/',path.sep));

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const expectedArg=process.argv.slice(2).find(v=>v.startsWith('--expected-source='));
if(process.argv.length!==3||!expectedArg||!/^--expected-source=[0-9a-f]{64}$/.test(expectedArg))throw Error('Usage: node tests/ui-packaged.mjs --expected-source=<frozen source SHA256>. Build and freeze the candidate first.');
const expectedSource=expectedArg.split('=')[1];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),hash=async file=>digest(await readFile(file));
function inside(base,relative){const file=path.resolve(base,relative),rel=path.relative(path.resolve(base),file);if(!rel||rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))throw Error('Package path escapes its expected directory.');return file;}
async function exists(file){try{await access(file);return true;}catch{return false;}}
const sourceBefore=await fingerprint(root);assert.equal(sourceBefore.fingerprint,expectedSource,'Source is not the frozen candidate.');
const buildManifest=JSON.parse(await readFile(path.join(root,'BUILD-MANIFEST.json'),'utf8'));assert.equal(buildManifest.sourceFingerprint,expectedSource,'Build manifest is stale.');
const manifest=JSON.parse(await readFile(path.join(root,'WINDOWS-BUILDS.json'),'utf8')),meta=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.electron,meta.devDependencies.electron);assert.deepEqual(manifest.builds.map(v=>v.kind).sort(),['offline','windows']);
const workspace=path.resolve(root,'../..'),work=inside(workspace,'work/ui-packaged-'+randomUUID());await mkdir(work,{recursive:true});
const output=path.join(root,'verification','ui-packaged');await mkdir(output,{recursive:true});
const report={version:1,passed:false,startedAt:new Date().toISOString(),sourceFingerprint:expectedSource,scope:'Exact production EXE and ASAR; renderer-only CDP; isolated disposable profiles; no financial signing or network execution.',harnessPath:fileURLToPath(import.meta.url),harnessSHA256:await hash(fileURLToPath(import.meta.url)),harnessAdaptation:'ASAR member paths normalized to the native separator; native sizing uses PID-bound Win32; actual product Settings zoom is verified through browser DPR. No main inspector or CSS zoom override.',builds:[],unmetRequirements:[],mainnetTransactions:0,financialSignatures:0,nativeDialogSubstitution:false,mainInspectorEnabled:false,workDirectory:work};
let phase='package-checks';
const rootRuntime=JSON.parse(await readFile(path.join(root,'RUNTIME-INTEGRITY.json'),'utf8'));
const expectedSources=['main.cjs','preload.cjs','preparation-import.cjs','market-data.cjs','account-balances.cjs','transaction-summary.cjs','ui-routes-main.cjs','ui-assets.json','wallet-store.cjs','signature-store.cjs','transaction-store.cjs','web-links.cjs','tools/bridge-intent-codecs.cjs','ui/index.html','ui/style.css','ui/shell.js','ui/routes.js','ui/chooser.js','ui/chooser.css','ui/black.css','ui/portfolio.js','ui/workspace.js','ui/assets.js','ui/assets/blue/app.ico'];
const expectedDist=['worker.cjs','payment.cjs','swap.cjs','hinkal.cjs','hinkal-proof-link.cjs','lifi-evm.cjs','lifi-solana.cjs','lifi-mayan-evm.cjs','lifi-relay.cjs','mayan-solana.cjs','mayan-evm-redeem.cjs','hinkal-solana.cjs','hinkal-solana-spend.cjs','hinkal-evm-swap.cjs','hinkal-local-swap.cjs','hinkal-solana-swap.cjs','hinkal-local-solana-swap-worker.cjs','receive.cjs'];
const requiredFuses=new Map([[FuseV1Options.RunAsNode,FuseState.DISABLE],[FuseV1Options.EnableCookieEncryption,FuseState.ENABLE],[FuseV1Options.EnableNodeOptionsEnvironmentVariable,FuseState.DISABLE],[FuseV1Options.EnableNodeCliInspectArguments,FuseState.DISABLE],[FuseV1Options.EnableEmbeddedAsarIntegrityValidation,FuseState.ENABLE],[FuseV1Options.OnlyLoadAppFromAsar,FuseState.ENABLE]]);
const {WalletStore}=require('../wallet-store.cjs');
function childEnvironment(profile){const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','APPDATA','LOCALAPPDATA','USERPROFILE'])if(process.env[key])env[key]=process.env[key];if(profile){env.APPDATA=path.join(profile,'Roaming');env.LOCALAPPDATA=path.join(profile,'Local');env.TEMP=path.join(profile,'Temp');env.TMP=env.TEMP;}return env;}
async function createEncryptedFixture(node,worker,profile,userDataNames){
  const entropy=randomBytes(36);let password=entropy.toString('base64');entropy.fill(0);
  let vault;
  try{vault=await new Promise((resolve,reject)=>{
    const child=spawn(node,['--no-addons','--max-old-space-size=256',worker],{windowsHide:true,env:childEnvironment(),stdio:['pipe','pipe','ignore']});
    const parts=[];let size=0,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);parts.forEach(v=>v.fill(0));error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Disposable encrypted fixture creation timed out.'));},90000);
    child.on('error',()=>finish(Error('Packaged fixture worker could not start.')));
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>1024*1024){bytes.fill(0);child.kill();finish(Error('Fixture worker exceeded its output limit.'));}else parts.push(bytes);});
    child.on('close',(code,signal)=>{let raw;try{raw=Buffer.concat(parts);const value=JSON.parse(raw.toString('utf8'));if(code!==0||signal||!value.ok||value.result?.kind!=='drivekey-multi-vault')throw Error();finish(null,value.result);}catch{finish(Error('Packaged fixture worker did not return an encrypted vault.'));}finally{raw?.fill(0);}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action:'create',password}));
  });}finally{password=undefined;}
  const file=path.join(profile,'disposable-unfunded-vault.json');await writeFile(file,JSON.stringify(vault)+'\n',{flag:'wx',mode:0o600});
  const catalog=new WalletStore(path.join(profile,'wallet-catalog-v1.json')),record=await catalog.upsert(file,vault,vault.public,'Disposable UI check');
  // Isolate both Chromium's explicit profile and Electron's environment-derived
  // userData fallback. Every catalog points at the same disposable encrypted file.
  const catalogBytes=await readFile(path.join(profile,'wallet-catalog-v1.json'));
  for(const name of userDataNames){const directory=inside(profile,path.join('Roaming',name));await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'wallet-catalog-v1.json'),catalogBytes,{flag:'wx',mode:0o600});}
  const result={walletId:record.id,deviceId:vault.public.deviceId,fixtureFile:file};vault=undefined;return result;
}
async function launch(executable,profile,operation){
  for(const name of ['Roaming','Local','Temp'])await mkdir(path.join(profile,name),{recursive:true});
  const child=spawn(executable,['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--disable-background-networking','--disable-component-update','--disable-sync','--disable-domain-reliability','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],{windowsHide:true,env:childEnvironment(profile),stdio:['ignore','ignore','pipe']});
  let browser;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let text='',done=false;const timer=setTimeout(()=>finish(Error('Packaged renderer CDP endpoint unavailable.')),25000);const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};child.once('error',()=>finish(Error('Production executable could not start.')));child.once('exit',(code,signal)=>finish(Error('Production executable exited before CDP connection ('+code+', '+signal+').')));child.stderr.on('data',data=>{text=(text+data.toString()).slice(-131072);const match=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(text);if(match)finish(null,match[1]);});});
    browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];assert.ok(context,'Production browser context missing.');
    const networkAttempts=[];await context.route(/^https?:\/\//,route=>{networkAttempts.push(new URL(route.request().url()).origin);return route.abort();});
    let page=context.pages().find(p=>p.url().startsWith('file:'));if(!page)page=await context.waitForEvent('page',{timeout:20000});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>document.body.dataset.ready==='true',{},{timeout:45000});
    const result=await operation({page,context,browser,pid:child.pid,networkAttempts,errors});assert.equal(errors.length,0,'Production renderer raised an error.');assert.equal(networkAttempts.length,0,'Unexpected renderer network request.');return result;
  }finally{
    if(browser)await browser.close().catch(()=>{});
    if(child.exitCode===null){child.kill();await new Promise(resolve=>{const t=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(t);resolve();});});}
  }
}
async function nativeSize(page,pid,width,height){
  assert.ok(Number.isInteger(pid)&&pid>0);assert.ok([850,1440].includes(width));assert.ok([650,1000].includes(height));
  const script=`Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class UIHarnessWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int mode);
}
'@
[UIHarnessWindow]::SetProcessDPIAware() | Out-Null
$target = Get-Process -Id ${pid} -ErrorAction Stop
$window = $target.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'Expected production window is missing.' }
$owner = [uint32]0
[UIHarnessWindow]::GetWindowThreadProcessId($window,[ref]$owner) | Out-Null
if ($owner -ne ${pid}) { throw 'Window belongs to another process.' }
$dpi = [UIHarnessWindow]::GetDpiForWindow($window)
if ($dpi -lt 96) { throw 'Invalid window DPI.' }
$nativeWidth = [int][Math]::Round(${width} * $dpi / 96.0)
$nativeHeight = [int][Math]::Round(${height} * $dpi / 96.0)
[UIHarnessWindow]::ShowWindow($window,9) | Out-Null
if (-not [UIHarnessWindow]::SetWindowPos($window,[IntPtr]::Zero,0,0,$nativeWidth,$nativeHeight,0x16)) { throw 'Native resize failed.' }
$rect = New-Object UIHarnessWindow+RECT
if (-not [UIHarnessWindow]::GetWindowRect($window,[ref]$rect)) { throw 'Window size readback failed.' }
@{width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top);expectedWidth=$nativeWidth;expectedHeight=$nativeHeight;dpi=$dpi} | ConvertTo-Json -Compress`;
  const native=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{windowsHide:true,timeout:15000,encoding:'utf8'}));assert.equal(native.width,native.expectedWidth);assert.equal(native.height,native.expectedHeight);
  await page.waitForTimeout(150);return {...await page.evaluate(()=>({innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio})),native,method:'PID-bound Win32 SetWindowPos with GetWindowRect readback'};
}
const baselineDpr = new Map();
async function zoom(page,pid,wanted){
  const baseline=baselineDpr.get(pid);assert.ok(baseline>0,'Missing native DPR baseline.');
  await page.locator('.nav-item[data-view="settings"]').click();
  await page.getByRole('tab',{name:'General',exact:true}).click();const select=page.locator('#interface-zoom');await page.locator('[data-chooser-for=interface-zoom]').waitFor({state:'visible'});
  const options=await select.locator('option').evaluateAll(items=>items.map(item=>item.value));
  const choice=factor=>options.includes(String(factor*100))?String(factor*100):options.includes(String(factor))?String(factor):null;
  const reset=choice(1),target=choice(wanted);assert.ok(reset&&target,'Product zoom selector lacks required values.');
  await choose(page,'#interface-zoom',reset);await page.waitForFunction(target=>Math.abs(devicePixelRatio-target)<0.025,baseline,{timeout:10000});
  if(wanted!==1){await choose(page,'#interface-zoom',target);await page.waitForFunction(target=>Math.abs(devicePixelRatio-target)<0.025,baseline*wanted,{timeout:10000});}
  const dpr=await page.evaluate(()=>devicePixelRatio),factor=dpr/baseline;assert.ok(Math.abs(factor-wanted)<0.025,'Product zoom differs from selected value.');
  return {factor,dpr,method:'Actual product Settings interface-zoom control; browser DPR verified, no CSS zoom override'};
}async function captureView(page,build,view,label){
  const nav=page.locator('.nav-item[data-view="'+view+'"]');await nav.click();await page.waitForFunction(view=>document.querySelector('[data-page="'+view+'"]')?.hidden===false,view);await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all([...document.images].filter(i=>i.hasAttribute('src')).map(i=>i.decode().catch(()=>{}))));
  const check=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,innerWidth,missingImages:[...document.querySelectorAll('img[src]')].filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src')),page:document.querySelector('.page:not([hidden])')?.dataset.page,heading:document.querySelector('.page:not([hidden]) h1')?.textContent}));
  assert.equal(check.page,view);assert.ok(check.heading);assert.ok(check.scrollWidth<=check.clientWidth+1,'Horizontal overflow in '+build+'/'+view+'/'+label);assert.deepEqual(check.missingImages,[],'Missing packaged local image.');
  const name=build+'-'+view+'-'+label+'.png';const cdp=await page.context().newCDPSession(page);try{const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});const png=Buffer.from(capture.data,'base64'),viewport=await page.evaluate(()=>({width:innerWidth*devicePixelRatio,height:innerHeight*devicePixelRatio}));assert.ok(Math.abs(png.readUInt32BE(16)-viewport.width)<=2,'Screenshot width must cover the physical viewport.');assert.ok(Math.abs(png.readUInt32BE(20)-viewport.height)<=2,'Screenshot height must cover the physical viewport.');await writeFile(path.join(output,name),png);}finally{await cdp.detach();}return {view,layout:label,...check,screenshot:name};
}
async function uiChecks(build,executable,profile,fixture){return launch(executable,profile,async({page,context,pid,networkAttempts,errors})=>{
  const isolation=await page.evaluate(async()=>({requireType:typeof require,processType:typeof process,bufferType:typeof Buffer,webContentsType:typeof webContents,apiMethods:Object.keys(window.drivekey),userAgent:navigator.userAgent,externalFetchSucceeded:await fetch('https://example.invalid').then(()=>true,()=>false)}));
  assert.equal(isolation.requireType,'undefined');assert.equal(isolation.processType,'undefined');assert.equal(isolation.bufferType,'undefined');assert.equal(isolation.webContentsType,'undefined');assert.equal(isolation.externalFetchSucceeded,false);assert.ok(isolation.userAgent.includes('Electron/'+meta.devDependencies.electron));
  for(const name of ['importPreparedPrivate','importPreparedBridge','reviewSavedRequest','getTransaction','copyPaymentRequest','invalidatePreparedReview','interfaceSettings','setInterfaceZoom'])assert.ok(isolation.apiMethods.includes(name),'Packaged preload misses '+name);
  assert.equal(isolation.apiMethods.some(name=>/eval|invoke|executejavascript|testhook/i.test(name)),false,'Unexpected generic/test bridge exposed.');
  await page.locator('.nav-item[data-view="vault"]').click();const row=page.locator('[data-wallet-id="'+fixture.walletId+'"]');await row.getByRole('button',{name:'Use wallet',exact:true}).click();await page.waitForFunction(id=>window.DK.context().public?.deviceId===id,fixture.deviceId);assert.equal(await page.locator('#backup-state').textContent(),'Not verified this session');
  const api=(method,...args)=>page.evaluate(async({method,args})=>window.drivekey[method](...args),{method,args});
  const mode=await api('applicationMode');assert.equal(mode.ok,true);assert.equal(mode.result.offline,build.kind==='offline');
  const offlineDenials=[];
  if(build.kind==='offline'){
    for(const [method,args]of [['marketSnapshot',['usd']],['accountBalances',['11111111-1111-4111-8111-111111111111']],['configureRPC',[]],['importWatchWallet',[]],['openWeb',['hinkal-pay']],['paymentBalance',[{chain:'ethereum',asset:'ETH'}]],['preparePayment',[{chain:'ethereum',asset:'ETH',recipient:'0x2222222222222222222222222222222222222222',amount:'1'}]],['hinkalDiscover',[{chain:'ethereum',action:'swap-quote',tokenIn:'ETH',amount:'1'}]],['importPreparedPrivate',[{chain:'ethereum',action:'deposit'}]],['importPreparedBridge',[{route:'mayan-solana-source'}]]]){
      const denied=await api(method,...args);assert.equal(denied.ok,false,'Offline method unexpectedly allowed: '+method);assert.match(denied.error,/offline|network|external/i);offlineDenials.push({method,rejected:true});
    }
    for(const view of ['home','payments','receive','swap','private','activity'])assert.equal(await page.locator('.nav-item[data-view="'+view+'"]').isVisible(),false,'Online navigation visible offline.');
  }
  const views=build.kind==='offline'?['review','vault','signatures','security','settings']:['home','vault','payments','receive','swap','private','activity','review','security','settings'];
  baselineDpr.set(pid,await page.evaluate(()=>devicePixelRatio));
  const invalidZoom=await api('setInterfaceZoom',999);assert.equal(invalidZoom.ok,false,'Unbounded zoom was accepted.');
  const screens=[];let zoomFailure=null,zoomSucceeded=false;
  for(const [label,width,height,factor]of [['desktop',1440,1000,1],['compact',850,650,1],['desktop-200',1440,1000,2],['compact-200',850,650,2]]){
    const nativeWindow=await nativeSize(page,pid,width,height);let zoomState;
    if(factor===1){const ratio=(await page.evaluate(()=>devicePixelRatio))/(nativeWindow.native.dpi/96);assert.ok(Math.abs(ratio-1)<0.025,'Unexpected zoom in fresh production profile.');zoomState={factor:1,method:'fresh unzoomed profile; DPR matches native window DPI'};}
    else{
      try{if(zoomFailure)throw Error(zoomFailure);zoomState=await zoom(page,pid,factor);zoomSucceeded=true;}
      catch(error){zoomFailure=error.message;report.unmetRequirements.push({build:build.kind,layout:label,requirement:'actual native 200% browser zoom',reason:zoomFailure});continue;}
    }
    for(const view of views)screens.push({...await captureView(page,build.kind,view,label),nativeWindow,zoom:zoomState});
  }
  if(zoomSucceeded)await zoom(page,pid,1);await nativeSize(page,pid,1440,1000);
  if(build.kind==='windows'){
    await page.locator('.nav-item[data-view="receive"]').click();await page.locator('[data-receive-tab="request"]').click();await choose(page,'#qr-chain','sepolia');await choose(page,'#qr-asset','USDC');await page.locator('#qr-amount').fill('1.25');await page.locator('#qr-form button[type="submit"]').click();await page.waitForSelector('#amount-qr:not([hidden])');assert.match(await page.locator('#qr-uri').textContent(),/1250000/);await page.locator('#qr-amount').fill('2');assert.equal(await page.locator('#amount-qr').isVisible(),false);assert.equal(await page.locator('#copy-request').isVisible(),false);
    await page.locator('.nav-item[data-view="swap"]').click();await choose(page,'#trade-chain','solana');assert.equal(await page.locator('#trade-provider').inputValue(),'lifi');assert.equal(await page.locator('#trade-recipient-field').isVisible(),false);
    await page.locator('.nav-item[data-view="private"]').click();await choose(page,'#private-action','withdraw');assert.match(await page.locator('#private-visibility').textContent(),/public address/i);
  }
  await page.locator('.nav-item[data-view="review"]').click();assert.equal(await page.locator('#sign-submit').isEnabled(),false,'No request/backup must mean no signing action.');
  assert.equal((await api('listSignatures')).result.length,0,'UI smoke test unexpectedly created a signature.');assert.equal((await api('listTransactions')).result.length,0,'UI smoke test unexpectedly prepared a transaction.');
  return {passed:true,isolation,fixtureCreatedByPackagedWorker:true,selectedThroughNativeUi:true,backupVerified:false,offlineDenials,screens,rendererErrors:errors,externalRequests:networkAttempts,signaturesCreated:0,transactionsPrepared:0};
});}
async function tamperCheck(build){
  const original=inside(root,build.directory),copy=inside(work,'tampered-package');await cp(original,copy,{recursive:true});const archive=path.join(copy,'resources','app.asar'),bytes=await readFile(archive);assert.ok(bytes.length>21);bytes[20]^=1;await writeFile(archive,bytes);
  const tamperProfile=inside(work,'tamper-profile');for(const name of ['Roaming','Local','Temp'])await mkdir(path.join(tamperProfile,name),{recursive:true});
  const result=await new Promise((resolve,reject)=>{const child=spawn(path.join(copy,path.basename(build.executable)),['--user-data-dir='+tamperProfile,'--disable-background-networking'],{windowsHide:true,env:childEnvironment(tamperProfile),stdio:'ignore'});const timer=setTimeout(()=>{child.kill();reject(Error('Tampered ASAR did not fail closed within 20 seconds.'));},20000);child.once('error',()=>{clearTimeout(timer);reject(Error('Tamper-copy process could not start.'));});child.once('exit',(code,signal)=>{clearTimeout(timer);if(code===0&&!signal)reject(Error('Tampered package exited successfully.'));else resolve({rejected:true,exitCode:code,signal});});});
  return {...result,originalAsarUnchanged:await hash(path.join(original,'resources','app.asar'))===build.asarSHA256};
}
try{
  for(const build of manifest.builds){
    phase='package-'+build.kind;console.log('CHECK exact '+build.kind+' package');const dir=inside(root,build.directory),exe=inside(root,build.executable),archive=path.join(dir,'resources','app.asar');assert.equal(path.dirname(exe),dir);assert.equal(path.basename(exe),build.kind==='offline'?'DriveKey Offline Companion.exe':'DriveKey Windows.exe');
    assert.equal(await hash(exe),build.sha256);assert.equal(await hash(archive),build.asarSHA256);const fuseWire=await getCurrentFuseWire(exe);for(const [key,value]of requiredFuses)assert.equal(fuseWire[key],value,'Production fuse changed: '+key);
    const packagedMeta=JSON.parse(extractFile(archive,'package.json').toString());assert.equal(packagedMeta.main,'main.cjs');assert.equal(packagedMeta.version,meta.version);assert.equal(packagedMeta.drivekeyOffline,build.kind==='offline');
    const runtime=JSON.parse(extractFile(archive,'RUNTIME-INTEGRITY.json').toString());assert.deepEqual(runtime,rootRuntime);
    const sourceHashes={};for(const file of [...expectedSources,...JSON.parse(await readFile(path.join(root,'ui-assets.json'),'utf8')).map(f=>'ui/'+f)]){const actual=digest(extractFile(archive,file)),expected=await hash(path.join(root,file));assert.equal(actual,expected,'Packaged source/asset changed: '+file);sourceHashes[file]=actual;}
    const dist=build.kind==='offline'?expectedDist:[...expectedDist,'online-worker.cjs','hinkal-worker.cjs'];for(const file of dist)assert.equal(digest(extractFile(archive,'dist/'+file)),buildManifest.binaryHashes[file],'Packaged bundle mismatch: '+file);
    const node=path.join(dir,'resources','node.exe'),worker=path.join(dir,'resources/app.asar.unpacked/dist/worker.cjs');assert.equal(await hash(node),runtime['node.exe']);assert.equal(await hash(worker),runtime['dist/worker.cjs']);
    const entries=listPackage(archive).map(p=>p.replaceAll('\\','/').replace(/^\//,''));if(build.kind==='offline')for(const file of ['online-worker.cjs','hinkal-worker.cjs']){assert.equal(entries.includes('dist/'+file),false,'Online worker included offline.');assert.equal(await exists(path.join(dir,'resources/app.asar.unpacked/dist',file)),false);}else for(const file of ['online-worker.cjs','hinkal-worker.cjs'])assert.equal(await hash(path.join(dir,'resources/app.asar.unpacked/dist',file)),runtime['dist/'+file]);
    const profile=inside(work,build.kind+'-profile');await mkdir(profile,{recursive:true});const fixture=await createEncryptedFixture(node,worker,profile,[...new Set([packagedMeta.name,path.basename(exe,'.exe')])]);
    phase='ui-'+build.kind;const checks=await uiChecks(build,exe,profile,fixture);report.builds.push({kind:build.kind,executableSHA256:build.sha256,asarSHA256:build.asarSHA256,fuses:fuseWire,sourceHashes,runtime,checks});
  }
  phase='tampered-asar';report.tamperedAsar=await tamperCheck(manifest.builds.find(b=>b.kind==='windows'));assert.equal(report.tamperedAsar.originalAsarUnchanged,true);
  assert.equal((await fingerprint(root)).fingerprint,expectedSource,'Source changed during packaged verification.');if(report.unmetRequirements.length){phase='required-native-zoom';throw Error('Actual native 200% zoom remains unverified; all completed checks are retained.');}report.passed=true;report.completedAt=new Date().toISOString();report.limitations=['No financial transaction was signed or broadcast.','No native file-picker or approval dialog was substituted or exercised; separate native-flow tests cover synthetic dialogs.','Encrypted fixture creation and public identity inspection are not funded qualification.','Physical two-computer isolation, publisher signing and independent certification were not tested.'];
}catch(error){report.failedPhase=phase;report.error=error?.message||'Packaged verification failed.';report.completedAt=new Date().toISOString();process.exitCode=1;}
await writeFile(path.join(output,'UI-PACKAGED.json'),JSON.stringify(report,null,2)+'\n');console.log(report.passed?'PASS exact production packages, native layouts, isolation and offline denials.':'FAIL packaged verification at '+report.failedPhase+': '+report.error);

async function choose(page,selector,value){const field=page.locator(selector);const disclosure=field.locator('xpath=ancestor::details[1]');if(await disclosure.count()&&await disclosure.getAttribute('open')===null)await disclosure.locator('summary').first().click();const id=await field.getAttribute('id'),index=await field.evaluate((s,wanted)=>[...s.options].findIndex(o=>o.value===wanted),value);if(index<0)throw Error('No matching visible choice');await page.locator('[data-chooser-for="'+id+'"]').click();await page.locator('.dk-choice-menu:not(.closing) [data-index="'+index+'"]').click();}
