// Linux-only deterministic config-path replacement test. No production mutations.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'linux');
const bundle=resolve(process.argv[2]);assert.ok(existsSync(bundle));
const work=mkdtempSync(join(tmpdir(),'drivekey-review-io-'));
const shim=join(work,'swap-before-open.cjs');
writeFileSync(shim,`const fs=require('node:fs'),fsp=require('node:fs/promises'),cp=require('node:child_process'),mod=require('node:module');
const config=process.env.TEST_CONFIG,mark=process.env.TEST_MARK;const realpath=fsp.realpath,open=fsp.open;let swapped=false;
fsp.realpath=async function(p,...rest){const result=await realpath(p,...rest);if(p===config&&!swapped){swapped=true;fs.renameSync(p,p+'.original');const c=cp.spawnSync('/usr/bin/mkfifo',[p]);if(c.status!==0)throw Error('mkfifo failed');fs.writeFileSync(mark,'fifo-replaced');}return result;};
fsp.open=async function(p,flags,...rest){if(p===config){if(!fs.lstatSync(p).isFIFO())throw Error('Expected FIFO');fs.appendFileSync(mark,';open-flags='+flags);if(process.env.TEST_REMOVE_NONBLOCK==='1')flags&=~fs.constants.O_NONBLOCK;}return open(p,flags,...rest);};
mod.syncBuiltinESMExports();
`);
try{
 const cases=[];
 for(const negative of [false,true]){
  const config=join(work,negative?'negative.json':'positive.json'),mark=config+'.mark',out=config+'.output';writeFileSync(config,'{}');
  const run=spawnSync(process.execPath,['--require',shim,bundle,config,out],{env:{...process.env,TEST_CONFIG:config,TEST_MARK:mark,TEST_REMOVE_NONBLOCK:negative?'1':'0'},encoding:'utf8',timeout:negative?1500:5000,killSignal:'SIGKILL',maxBuffer:65536});
  const evidence=readFileSync(mark,'utf8');assert.match(evidence,/fifo-replaced;open-flags=/);assert.equal(existsSync(out),false);
  if(negative){assert.equal(run.error?.code,'ETIMEDOUT');}
  else{assert.equal(run.error,undefined);assert.equal(run.status,1);assert.match(run.stderr,/Config changed on open/);}
  cases.push({case:negative?'negative-control-remove-nonblock':'real-cli-config-fifo-replacement',fifoSwapObserved:true,exitCode:run.status,timedOut:run.error?.code==='ETIMEDOUT',noPacketWritten:true,expectedBehavior:true});
 }
 console.log(JSON.stringify({kind:'deterministic-linux-config-fifo-race-check',bundleSha256:createHash('sha256').update(readFileSync(bundle)).digest('hex'),cases,success:true,productionMutated:false}));
}finally{rmSync(work,{recursive:true,force:true});}
