'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
test('all bundles and the lockfile exclude elliptic and the unused NEAR refund dependency',()=>{
 const manifest=require('../BUILD-MANIFEST.json'),workers=Object.keys(manifest.binaryHashes);
 for(const name of ['worker.cjs','hinkal-worker.cjs','online-worker.cjs'])assert.ok(workers.includes(name));
 const lock=fs.readFileSync(path.resolve(__dirname,'../pnpm-lock.yaml'),'utf8');assert.equal(lock.includes('elliptic@'),false);assert.equal(lock.includes('@defuse-protocol/intents-sdk@'),false);
 const blocked=new Set(['elliptic@6.6.1','uuid@8.3.2','axios@1.18.0','axios@1.19.0','protobufjs@6.11.6','toml@3.0.0','node-forge@1.4.0','zod@3.25.76','@solana/web3.js@1.68.0']);
 for(const name of workers){
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../dist',name))).digest('hex'),manifest.binaryHashes[name]);
  const dependencies=manifest.runtimeDependencies[name];assert.ok(Array.isArray(dependencies));
  if(['worker.cjs','hinkal-worker.cjs','online-worker.cjs'].includes(name))assert.ok(dependencies.length>0);
  assert.deepEqual(dependencies.filter(d=>blocked.has(d)),[],name+' contains an audited vulnerable dependency');
  assert.deepEqual(dependencies.filter(d=>d.startsWith('elliptic@')||d.startsWith('@defuse-protocol/intents-sdk@')),[],name+' loads the removed SDK dependency tree');
 }
});
