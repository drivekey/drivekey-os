// Actual packaged UI + main IPC. The OS browser is stubbed; no quote or transfer is submitted.
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const deps=createRequire(path.join(process.env.DRIVEKEY_BUILD_MODULES||root,'package.json'));
const {_electron}=deps('@playwright/test');
const {createTestPaths,captureScreen}=require('./test-output.cjs');
const {scratch,output}=createTestPaths('swap-acceptance');

(async()=>{
 await fs.mkdir(scratch,{recursive:true});
 const app=await _electron.launch({executablePath:path.join(root,'portable','DriveKey Connect Preview.exe'),args:['--user-data-dir='+path.join(scratch,'profile')],timeout:30000});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#start');await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const file of ['main.cjs','ui/index.html','ui/app.js','ui/style.css','web-links.cjs'])assert.deepEqual(await fs.readFile(path.join(root,file)),await fs.readFile(path.join(root,'portable','resources','app',file)),file+' source/package mismatch');
  await app.evaluate(({shell})=>{global.__swapOpened=[];shell.openExternal=async url=>{global.__swapOpened.push(url);};});
  await page.evaluate(()=>document.fonts.ready);
  await fs.mkdir(output,{recursive:true});
  const capture=async name=>{
   await page.locator('#toast').waitFor({state:'hidden',timeout:12000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow');
   await captureScreen(page,path.join(output,name));
  };
  const providers=[
   {key:'lifi',chain:'ethereum',name:'LI.FI',image:'15-swap-lifi.png'},
   {key:'jupiter',chain:'solana',name:'Jupiter',image:'12-swap.png'},
   {key:'direct',chain:'ethereum',name:'Uniswap',image:'16-swap-uniswap.png'},
   {key:'husher',chain:'ethereum',name:'Husher',image:'19-swap-husher.png'}
  ];
  await page.click('[data-view=swap]');
  const cta=page.locator('[data-web-route=swap]');
  assert.equal(await page.locator('[data-provider]').count(),providers.length);
  assert.equal(await page.inputValue('#swap-provider'),'');
  assert.equal(await cta.isDisabled(),true);
  assert.equal(await page.locator('[data-chain]:visible').count(),0);
  await capture('17-swap-start.png');
  const providerMarks=[];
  for(const provider of providers){
   const button=page.locator('[data-provider='+provider.key+']');
   const mark=await button.locator('img').evaluate(img=>({src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0}));
   assert.equal(mark.loaded,true,provider.name+' logo failed to load');
   assert.match(mark.src,/^assets\//,'provider logo must be packaged locally');providerMarks.push(mark.src);
   await button.click();
   assert.equal(await page.inputValue('#swap-provider'),provider.key);
   assert.equal(await button.getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('[data-provider][aria-pressed=true]').count(),1);
   assert.equal(await page.locator('[data-chain][aria-pressed=true]').count(),0,'provider change must clear the chain');
   assert.equal(await cta.isDisabled(),true,'explicit chain selection is required');
   const chains=page.locator('[data-chain]:visible');
   assert.equal(await chains.count(),1,provider.name+' chain choices exceed current DriveKey support');
   assert.equal(await chains.first().getAttribute('data-chain'),provider.chain);
   const chain=page.locator('[data-chain='+provider.chain+']');
   await page.waitForFunction(key=>{const img=document.querySelector('[data-chain="'+key+'"] img');return img?.complete&&img.naturalWidth>0;},provider.chain);
   const chainMark=await chain.locator('img').evaluate(img=>({src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0}));
   assert.equal(chainMark.loaded,true,provider.chain+' mark failed to load');
   assert.match(chainMark.src,provider.chain==='solana'?/solana\.(png|svg)$/:/ethereum\.(png|svg)$/);
   await chain.click();assert.equal(await chain.getAttribute('aria-pressed'),'true');assert.equal(await cta.isEnabled(),true);
   await capture(provider.image);
   await cta.click();await page.waitForFunction(()=>document.querySelector('#working').hidden);
   assert.equal(await app.evaluate(()=>global.__swapOpened.at(-1)),'https://drivekey.info/app/swap?provider='+provider.key);
  }
  assert.equal(new Set(providerMarks).size,providers.length,'provider logos must be distinct assets');
  await page.click('[data-provider=jupiter]');await page.click('[data-chain=solana]');
  await page.setViewportSize({width:850,height:850});await capture('18-swap-compact.png');
  const isolated=await page.evaluate(()=>({require:typeof require,process:typeof process}));assert.deepEqual(isolated,{require:'undefined',process:'undefined'});
  const network=await page.evaluate(async()=>{try{await fetch('https://example.com');return 'allowed';}catch{return 'blocked';}});assert.equal(network,'blocked');
  const invalid=await page.evaluate(()=>window.drivekey.openWeb('swap','jupiter&chain=evil'));assert.equal(invalid.ok,false);
  assert.deepEqual(errors,[]);
  const report={checkedAt:new Date().toISOString(),passed:true,packagedExecutable:true,providers:providers.map(({key,chain,name})=>({key,chain,name})),checks:['provider selection is required before chains appear','only current DriveKey provider/chain pairs offered','explicit chain selection enables swap','switching provider clears chain and disables swap','four distinct local provider logos and correct local chain marks load','exact website destinations through main IPC','850px layout has no horizontal overflow','renderer Node unavailable and HTTP blocked','unsupported provider URL injection rejected'],systemBrowser:'Stubbed for automated acceptance; no swap submitted',chainHandoff:'Current website URL selects provider only; the selected chain is displayed locally and must be confirmed on the website.',pageErrors:errors};
  await fs.writeFile(path.join(output,'SWAP-TEST-RESULTS.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
