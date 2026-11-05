const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),workspace=path.resolve(root,'..','..');
function createTestPaths(suite){
 const scratch=path.join(workspace,'work',suite+'-'+Date.now()+'-'+randomUUID().slice(0,8));
 const output=process.env.DRIVEKEY_TEST_OUTPUT?path.resolve(process.env.DRIVEKEY_TEST_OUTPUT):path.join(scratch,'results');
 const relative=path.relative(root,output);
 if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Test results must be outside the app source and curated development gallery.');
 return {scratch,output};
}
async function captureScreen(page,file){
 await fs.mkdir(path.dirname(file),{recursive:true});await page.bringToFront();
 await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await page.screenshot({path:file,fullPage:true});
}
module.exports={createTestPaths,captureScreen};
