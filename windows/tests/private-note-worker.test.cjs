'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('shipped private-note inspection and signing remain denied without exposing unlock or note input',()=>{
 const marker='Never-disclose-private-note-worker-input';for(const action of ['inspect-product-notes','sign-product-proof']){const r=spawnSync(process.execPath,['--no-addons','--require',path.join(__dirname,'offline-network-deny.cjs'),path.join(__dirname,'../dist/worker.cjs')],{windowsHide:true,input:JSON.stringify({action,request:marker,vault:marker,password:marker,noteManifestFingerprint:'0'.repeat(64)}),encoding:'utf8',timeout:15000,maxBuffer:128*1024});assert.ifError(r.error);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).ok,false);assert.equal((r.stdout+r.stderr).includes(marker),false);assert.equal((r.stdout+r.stderr).includes('UNEXPECTED_SIGNER_NETWORK'),false);}
});
