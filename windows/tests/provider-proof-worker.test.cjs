'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
const p=require('./fixtures/provider-ethereum-deposit.json').package;
test('network-only provider worker refuses unqualified operation, secrets and unsupported actions before networking',()=>{
 const secret='NEVER-PRINT-PROVIDER-WORKER-SECRET';for(const file of ['provider-proof-worker.cjs','product-view-worker.cjs'])for(const job of [{action:'finalize-product-proof',input:{request:p.request,response:p.response},wallet:p.request.wallet},{action:'finalize-product-proof',input:{},wallet:p.request.wallet,password:secret},{action:'sign',vault:secret,password:secret},{action:'submit',input:secret},{action:file==='product-view-worker.cjs'?'prepare-scoped-private-proof':'finalize-product-proof',input:secret,wallet:p.request.wallet}]){
  const r=spawnSync(process.execPath,['--require',path.join(__dirname,'offline-network-deny.cjs'),path.join(__dirname,'../dist',file)],{input:JSON.stringify(job),windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:256*1024});assert.ifError(r.error);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).ok,false);assert.equal((r.stdout+r.stderr).includes(secret),false);assert.equal((r.stdout+r.stderr).includes('UNEXPECTED_SIGNER_NETWORK'),false);
 }
});
