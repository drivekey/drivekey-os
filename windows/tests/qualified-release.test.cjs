const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {qualifiedRelease}=require('../tools/qualified-release.cjs');
test('funded signature/submission gate binds passing checks to exact source and built artifacts',async()=>{
 const dir=path.resolve('work','qualification-'+randomUUID());fs.mkdirSync(dir,{recursive:true});
 try{
  for(const n of ['engine','online','merchant','contracts','tools','tests','ui','vendor','dist'])fs.mkdirSync(path.join(dir,n));
  for(const n of ['main.cjs','preload.cjs','preparation-import.cjs','market-data.cjs','account-balances.cjs','transaction-summary.cjs','ui-routes-main.cjs','ui-assets.json','signer.ts','worker.ts','receive.ts','wallet-store.cjs','signature-store.cjs','transaction-store.cjs','web-links.cjs','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','build.mjs','package-windows.mjs','release.mjs','tsconfig.json'])fs.writeFileSync(path.join(dir,n),'qualified source');
  const {fingerprint}=await import('../tools/fingerprint.mjs'),source=await fingerprint(dir),binaryHashes={};for(let i=0;i<10;i++){const n='worker-'+i+'.cjs';fs.writeFileSync(path.join(dir,'dist',n),'artifact '+i);binaryHashes[n]=createHash('sha256').update('artifact '+i).digest('hex');}
  const checks={passed:true,failed:0,fingerprint:source.fingerprint},build={sourceFingerprint:source.fingerprint,binaryHashes},save=()=>{fs.writeFileSync(path.join(dir,'ENGINEERING-CHECKS.json'),JSON.stringify(checks));fs.writeFileSync(path.join(dir,'BUILD-MANIFEST.json'),JSON.stringify(build));};save();
  await qualifiedRelease(dir);fs.appendFileSync(path.join(dir,'dist','worker-0.cjs'),'tampered');await assert.rejects(()=>qualifiedRelease(dir),/artifact/);fs.writeFileSync(path.join(dir,'dist','worker-0.cjs'),'artifact 0');
  build.sourceFingerprint='stale';save();await assert.rejects(()=>qualifiedRelease(dir),/must match/);build.sourceFingerprint=source.fingerprint;checks.passed=false;save();await assert.rejects(()=>qualifiedRelease(dir),/must match/);checks.passed=true;save();
  fs.appendFileSync(path.join(dir,'ui-assets.json'),'changed');await assert.rejects(()=>qualifiedRelease(dir),/must match/);fs.writeFileSync(path.join(dir,'ui-assets.json'),'qualified source');
  fs.appendFileSync(path.join(dir,'preparation-import.cjs'),'changed');await assert.rejects(()=>qualifiedRelease(dir),/must match/);fs.writeFileSync(path.join(dir,'preparation-import.cjs'),'qualified source');
  fs.appendFileSync(path.join(dir,'market-data.cjs'),'changed');await assert.rejects(()=>qualifiedRelease(dir),/must match/);fs.writeFileSync(path.join(dir,'market-data.cjs'),'qualified source');
  fs.appendFileSync(path.join(dir,'signer.ts'),'changed');await assert.rejects(()=>qualifiedRelease(dir),/must match/);
 }finally{const resolved=path.resolve(dir),workspace=path.resolve('work')+path.sep;if(!resolved.startsWith(workspace))throw Error('Invalid fixture cleanup');fs.rmSync(resolved,{recursive:true,force:true});}
});
