'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{build}=require('esbuild');
const root=path.resolve(__dirname,'..'),golden=require('./fixtures/hinkal-discovery-golden.json');let actual;
before(async()=>{
 const directory=path.resolve(root,'../discovery-fixture-'+randomUUID());await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'run.cjs');
 const compiled=await build({absWorkingDir:root,entryPoints:['tests/helpers/hinkal-discovery-fixture-entry.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',target:'node24',metafile:true});
 assert.deepEqual(Object.keys(compiled.metafile.inputs).filter(f=>/[/\\](?:elliptic|@defuse-protocol)[/\\]/.test(f)),[]);
 const child=spawnSync(process.execPath,['--require',path.join(root,'tests/offline-network-deny.cjs'),file],{input:JSON.stringify(golden.cases),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
 assert.equal(child.status,0,'Offline SDK discovery fixture did not finish');actual=JSON.parse(child.stdout);assert.equal(actual.length,golden.expected.length);
});
for(const [index,item]of golden.cases.entries())test('narrow SDK discovery preserves '+item.id,()=>{
 assert.deepEqual(actual[index],golden.expected[index]);
 if(actual[index].ok){assert.equal(actual[index].result.executionEnabled,false);assert.equal(actual[index].result.request.chain,item.input.chain);}
});
