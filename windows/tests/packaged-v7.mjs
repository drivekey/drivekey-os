import {chromium} from '@playwright/test';
import {getCurrentFuseWire,FuseV1Options,FuseState} from '@electron/fuses';
import {readFile,writeFile,mkdir,access,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.resolve(root,'../../work/packaged-v7-'+Date.now());await mkdir(work,{recursive:true});
const hash=async f=>createHash('sha256').update(await readFile(f)).digest('hex'),manifest=JSON.parse(await readFile(path.join(root,'WINDOWS-BUILDS.json'),'utf8')),results=[];
async function runApp(exe,profile,operation){
 const child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port=0'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';let browser;
 try{
  const endpoint=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Packaged debug endpoint not available.')),15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(Error('Packaged app exited '+code));});child.stderr.on('data',b=>{stderr+=b.toString();const match=/DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);if(match){clearTimeout(timeout);resolve(match[1]);}});});
  browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];let page=context.pages()[0];if(!page)page=await context.waitForEvent('page');await page.waitForFunction(()=>document.body.dataset.ready==='true');return await operation(page);
 }finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
}
for(const build of manifest.builds){
 const exe=path.join(root,build.executable),dir=path.join(root,build.directory),fuses=await getCurrentFuseWire(exe);
 if(fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]!==FuseState.ENABLE||fuses[FuseV1Options.OnlyLoadAppFromAsar]!==FuseState.ENABLE||fuses[FuseV1Options.RunAsNode]!==FuseState.DISABLE||fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable]!==FuseState.DISABLE||fuses[FuseV1Options.EnableNodeCliInspectArguments]!==FuseState.DISABLE)throw Error('Required packaging fuse missing.');
 const runtime=JSON.parse(await readFile(path.join(root,'RUNTIME-INTEGRITY.json'),'utf8'));for(const f of ['worker.cjs',...build.kind==='windows'?['online-worker.cjs']:[]])if(await hash(path.join(dir,'resources/app.asar.unpacked/dist',f))!==runtime['dist/'+f])throw Error('Packaged worker digest differs.');
 if(build.kind==='offline'){let found=false;try{await access(path.join(dir,'resources/app.asar.unpacked/dist/online-worker.cjs'));found=true;}catch{}if(found)throw Error('Offline build includes online worker.');}
 const checks=await runApp(exe,path.join(work,build.kind),async page=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const isolation=await page.evaluate(async()=>({node:typeof require,process:typeof process,network:await fetch('https://example.com').then(()=>true,()=>false),api:Object.keys(window.drivekey).length,userAgent:navigator.userAgent}));if(isolation.node!=='undefined'||isolation.process!=='undefined'||isolation.network)throw Error('Packaged renderer isolation failed.');
  const locked=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).devDependencies.electron;if(!isolation.userAgent.includes('Electron/'+locked))throw Error('Packaged Electron differs from the locked dependency.');
  await page.click('[data-view=payments]');await page.screenshot({path:path.join(root,'verification','packaged-'+build.kind+'.png'),fullPage:true});await page.setViewportSize({width:850,height:780});if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Packaged compact layout overflow.');
  if(build.kind==='offline'){const blocked=await page.evaluate(()=>window.drivekey.configureRPC());if(blocked.ok!==false||!blocked.error.includes('Offline'))throw Error('Offline networking gate failed.');const links=await page.evaluate(()=>window.drivekey.openWeb('hinkal-pay'));if(links.ok!==false)throw Error('Offline external link gate failed.');}
  if(errors.length)throw Error('Packaged renderer error.');return {isolation,errors,compactLayout:true,offlineNetworkingDisabled:build.kind==='offline'};
 });
 // Actual disposable packaged worker; no plaintext key is returned or logged.
 const worker=path.join(dir,'resources/app.asar.unpacked/dist/worker.cjs'),node=path.join(dir,'resources/node.exe');if(await hash(node)!==runtime['node.exe'])throw Error('Packaged Node integrity mismatch.');
 const workerResult=await new Promise((resolve,reject)=>{const c=spawn(node,['--no-addons',worker],{windowsHide:true,stdio:['pipe','pipe','ignore']});let output='';c.stdout.on('data',b=>output+=b);c.on('error',reject);c.on('exit',code=>{try{const r=JSON.parse(output);if(code||!r.ok||r.result.kind!=='drivekey-multi-vault')throw Error('Packaged worker failed.');resolve({createdEncryptedVault:true,evmAndSolanaIdentities:!!r.result.public.evmAddress&&!!r.result.public.solanaAddress});}catch(e){reject(e);}});c.stdin.end(JSON.stringify({action:'create',password:'Disposable packaged-v7 acceptance passphrase'}));});
 results.push({kind:build.kind,passed:true,executableSHA256:await hash(exe),asarSHA256:await hash(path.join(dir,'resources/app.asar')),fuses,checks,workerResult});
}
// Tamper only a scratch copy. The delivery binaries are never mutated by this test.
const original=path.join(root,manifest.builds[0].directory),tamper=path.join(work,'tamper');await cp(original,tamper,{recursive:true});const archive=path.join(tamper,'resources/app.asar'),bytes=await readFile(archive);bytes[20]^=1;await writeFile(archive,bytes);
const rejection=await new Promise((resolve,reject)=>{const c=spawn(path.join(tamper,'DriveKey Windows.exe'),['--user-data-dir='+path.join(work,'tamper-profile')],{windowsHide:true,stdio:'ignore'}),timer=setTimeout(()=>{c.kill();reject(Error('Tampered ASAR did not fail closed promptly.'));},15000);c.on('error',reject);c.on('exit',(code,signal)=>{clearTimeout(timer);if(code===0&&!signal)reject(Error('Tampered app exited successfully.'));else resolve({rejected:true,exitCode:code,signal});});});
const report={passed:true,checkedAt:new Date().toISOString(),builds:results,tamperedAsar:rejection,publisherSigningVerified:false,physicalTwoComputerTest:false,limitations:['Chromium CDP observes renderer only; hardened main inspector fuse stays disabled','Native file picker and approval interaction in exact hardened packages is not covered by this smoke test','Separate source Electron test covers main/IPC/signing/restart with actual DPAPI and substituted dialogs','No mainnet funds or provider execution']};await writeFile(path.join(root,'verification','PACKAGED-V7.json'),JSON.stringify(report,null,2)+'\n');console.log('Both hardened packaged builds pass startup, renderer isolation, worker creation and tampered ASAR rejection.');
