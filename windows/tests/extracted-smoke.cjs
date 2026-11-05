// Invoked by release.mjs only after archive entry hashes and extraction verify.
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const originalRoot=path.resolve(__dirname,'..'),deps=createRequire(path.join(process.env.DRIVEKEY_BUILD_MODULES||originalRoot,'package.json'));
const {_electron}=deps('@playwright/test');
const extracted=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),workspace=path.resolve(originalRoot,'..','..');
const relative=path.relative(path.join(workspace,'work'),output);
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Extracted smoke profile must stay in workspace work/');
(async()=>{
 await fs.mkdir(output,{recursive:true});const profile=path.join(output,'profile'),app=await _electron.launch({executablePath:path.join(extracted,'portable','DriveKey Connect Preview.exe'),args:['--user-data-dir='+profile],timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>document.body.dataset.ready==='true');
  assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))).toLowerCase(),profile.toLowerCase());
  const state=await page.evaluate(()=>window.drivekey.listWallets());assert.equal(state.ok,true);assert.equal(state.result.wallets.length,0);assert.equal(state.result.activeId,null);assert.equal(state.result.recoveryRequired,false);
  const renderer=await page.evaluate(()=>({node:typeof require,process:typeof process,api:Object.keys(window.drivekey)}));assert.equal(renderer.node,'undefined');assert.equal(renderer.process,'undefined');assert.equal(renderer.api.length,19);
  assert.equal(await page.locator('#start').isVisible(),true);assert.deepEqual(errors,[]);
  const result={checkedAt:new Date().toISOString(),passed:true,launchedAfterZipExtraction:true,isolatedUserData:true,emptyWalletCatalog:true,rendererIsolation:true,apiMethods:19,pageErrors:errors,scope:'Actual extracted Windows executable startup and public catalog API. No wallet files, signature or funded operation created.'};
  await fs.writeFile(path.join(output,'ZIP-SMOKE-RESULTS.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
