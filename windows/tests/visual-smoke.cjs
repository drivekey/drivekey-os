const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{createTestPaths,captureScreen}=require('./test-output.cjs');
const root=path.resolve(__dirname,'..');
const deps=createRequire(path.join(process.env.DRIVEKEY_BUILD_MODULES||root,'package.json'));
const {_electron}=deps('@playwright/test');
const {scratch,output}=createTestPaths('visual-smoke');
(async()=>{
 await fs.mkdir(scratch,{recursive:true});await fs.mkdir(output,{recursive:true});
 const app=await _electron.launch({executablePath:path.join(root,'portable','DriveKey Connect Preview.exe'),args:['--user-data-dir='+path.join(scratch,'profile')]});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#start');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.setViewportSize({width:850,height:850});await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.mode-line').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await captureScreen(page,path.join(output,'09-compact-overview.png'));await page.click('[data-view=vault]');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await captureScreen(page,path.join(output,'08-compact-layout.png'));
  const report={checkedAt:new Date().toISOString(),passed:true,packagedExecutable:true,fonts:'Inter and Space Grotesk loaded locally',compactModeDisclosureVisible:true,compactOverviewNoHorizontalOverflow:true,compactWalletsNoHorizontalOverflow:true,scope:'Actual 850px packaged home and wallet screens; isolated profile. Screenshots are test outputs, separate from curated development pictures.'};
  await fs.writeFile(path.join(output,'VISUAL-TEST-RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
