import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fingerprint} from './fingerprint.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=new Set(process.argv.slice(2));
for(const arg of args)if(!['--unit-only','--check-only','--package-only'].includes(arg))throw Error('Unsupported release option.');if(args.size>1)throw Error('Choose a single release mode.');
const verification=path.join(root,'verification');await mkdir(verification,{recursive:true});
async function run(exe,argv,label){console.log('RUN '+label);const result=await new Promise((resolve,reject)=>{const c=spawn(exe,argv,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('exit',(code,signal)=>resolve({code,signal,out,err}));});await writeFile(path.join(verification,label+'.log'),result.out+'\n'+result.err);if(result.code!==0||result.signal){console.error(result.out.slice(-6000)+result.err.slice(-2000));throw Error(label+' failed.');}console.log('PASS '+label);return result;}
async function checks(){
 await run(process.execPath,['build.mjs'],'build');await run(process.execPath,['node_modules/typescript/lib/tsc.js','--noEmit'],'typecheck');
 const units=['dist/signer.test.cjs',...(await readdir(path.join(root,'tests'))).filter(f=>f.endsWith('.test.cjs')).map(f=>'tests/'+f)];
 const result=await run(process.execPath,['--test','--test-reporter=tap',...units],'unit-integration-adversarial');const passed=Number(/^# pass (\d+)$/m.exec(result.out)?.[1]),failed=Number(/^# fail (\d+)$/m.exec(result.out)?.[1]);if(!passed||failed!==0)throw Error('Missing passing TAP summary.');
 if(!args.has('--unit-only')){await run(process.execPath,['tests/ui/renderer-suite.cjs'],'ui-renderer');await run(process.execPath,['tests/ui-signing.cjs'],'ui-signing');await run(process.execPath,['tests/ui/native-smoke.cjs'],'ui-native-smoke');await run(process.execPath,['tests/merchant-ui.cjs'],'merchant-ui');}
 const source=await fingerprint(root);await writeFile(path.join(root,'ENGINEERING-CHECKS.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),unitTests:passed,failed,...source,desktopIncluded:!args.has('--unit-only'),scope:'Local cryptography, fixture adversarial tests, PostgreSQL WASM, local EVM. No funded production qualification.'},null,2)+'\n');
}
if(!args.has('--package-only'))await checks();
if(!args.has('--unit-only')&&!args.has('--check-only')){
 const checks=JSON.parse(await readFile(path.join(root,'ENGINEERING-CHECKS.json'),'utf8')),before=await fingerprint(root);if(!checks.passed||!checks.desktopIncluded||checks.fingerprint!==before.fingerprint)throw Error('Checks are stale or incomplete. Run pnpm check.');
 await run(process.execPath,['package-windows.mjs'],'package-windows');await run(process.execPath,['tests/ui-packaged.mjs','--expected-source='+before.fingerprint],'ui-packaged');
 const after=await fingerprint(root);if(before.fingerprint!==after.fingerprint)throw Error('Source changed during packaging.');
 await writeFile(path.join(root,'RELEASE-EVIDENCE.json'),JSON.stringify({checkedAt:new Date().toISOString(),sourceFingerprint:after.fingerprint,engineeringChecks:true,packagedChecks:true,fundingReady:false,independentReview:false,publisherSigning:false,controlledFundedAcceptance:false,physicalTwoComputerTest:false},null,2)+'\n');
 await run(process.execPath,['tools/inventory.mjs'],'inventory');
}
