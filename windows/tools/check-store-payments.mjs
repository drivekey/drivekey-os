// Local engineering only. This command does not issue signing/release grants.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fingerprint} from './fingerprint.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),local=createRequire(import.meta.url);
const {classifyStoreTests}=local('./store-test-results.cjs');
const output=path.join(root,'verification/store-payments');await fs.mkdir(output,{recursive:true});
if(process.argv.length!==2)throw Error('Usage: pnpm check:store');
const before=await fingerprint(root);
const policy=JSON.parse(await fs.readFile(path.join(root,'tests/store-local-check-policy.json'),'utf8'));
async function run(label,args){
 console.log('RUN '+label);
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:1200000});
  let stdout='',stderr='',size=0;
  const collect=(kind,data)=>{size+=data.length;if(size>32*1024*1024){child.kill();return;}if(kind==='stdout')stdout+=data;else stderr+=data;};
  child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));
  child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
 });
 await fs.writeFile(path.join(output,label+'.log'),result.stdout+'\n'+result.stderr);
 assert.equal(result.signal,null,label+' was interrupted');
 return result;
}
const build=await run('build',['build.mjs']);assert.equal(build.code,0,'Build failed');
const typecheck=await run('typecheck',['node_modules/typescript/lib/tsc.js','--noEmit']);assert.equal(typecheck.code,0,'Typecheck failed');
const files=['dist/signer.test.cjs',...(await fs.readdir(path.join(root,'tests'))).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>'tests/'+name)];
const full=await run('full-historical-suite',['--test','--test-reporter=tap',...files]);
const result=classifyStoreTests(full.stdout,policy);
assert.equal(full.code,result.stats.failures?1:0,'Unexpected test-runner exit code');
const after=await fingerprint(root);assert.equal(after.fingerprint,before.fingerprint,'Source changed while checking');
const manifest=JSON.parse(await fs.readFile(path.join(root,'BUILD-MANIFEST.json'),'utf8'));assert.equal(manifest.sourceFingerprint,after.fingerprint);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [file,hash]of Object.entries(manifest.binaryHashes))assert.equal(sha(await fs.readFile(path.join(root,'dist',file))),hash);
const report={checkedAt:new Date().toISOString(),scope:policy.scope,sourceFingerprint:after.fingerprint,buildPassed:true,typecheckPassed:true,generatedArtifactsRehashed:Object.keys(manifest.binaryHashes).length,...result,legacyRunnerExitCode:full.code,fullHistoricalLogSha256:sha(full.stdout+'\n'+full.stderr),qualificationIssued:false,fundedSigningQualified:false,installedPackageQualified:false,physicalIsolationVerified:false,submissionReady:false};
await fs.writeFile(path.join(output,'STORE-PAYMENTS-CHECKS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({paymentsOnlyPassed:report.paymentsOnlyPassed,fullHistoricalSuitePassed:report.fullHistoricalSuitePassed,...report.stats,deferredFailuresDisclosed:report.classifiedDeferred.length,qualificationIssued:false,submissionReady:false}));
if(!report.paymentsOnlyPassed)process.exitCode=1;
