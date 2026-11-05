'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const cli=path.resolve(__dirname,'../tools/check-full-product.mjs');
function run(entry,setup=()=>{}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drivekey-evidence-audit-'));
 fs.writeFileSync(path.join(root,'evidence.json'),'original evidence');setup(root);
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schemaVersion:1,release:{artifacts:{windowsExe:entry}},cases:[],gates:[]}));
 const result=spawnSync(process.execPath,[cli,path.join(root,'manifest.json')],{encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,1,result.stderr);return JSON.parse(result.stdout);
}
const hash=createHash('sha256').update('original evidence').digest('hex');
test('full-product CLI rehashes files and keeps incomplete evidence closed',()=>{const r=run({path:'evidence.json',sha256:hash});assert.equal(r.filesRehashed,1);assert.equal(r.evidenceComplete,false);assert.equal(r.submissionReady,false);assert.equal(r.failures.some(f=>typeof f==='object'),false);});
test('full-product CLI rejects modified and missing evidence',()=>{for(const entry of [{path:'evidence.json',sha256:'b'.repeat(64)},{path:'missing.json',sha256:hash}])assert.equal(run(entry).failures.some(f=>typeof f==='object'),true);});
test('full-product CLI rejects traversal, absolute paths and alternate streams',()=>{for(const name of ['../evidence.json',path.resolve('evidence.json'),'evidence.json:secret'])assert.equal(run({path:name,sha256:hash}).failures.some(f=>typeof f==='object'),true);});
test('full-product CLI rejects evidence redirected through a directory junction',()=>{const r=run({path:'redirect/evidence.json',sha256:hash},root=>{const outside=fs.mkdtempSync(path.join(os.tmpdir(),'drivekey-outside-evidence-'));fs.writeFileSync(path.join(outside,'evidence.json'),'original evidence');fs.symlinkSync(outside,path.join(root,'redirect'),process.platform==='win32'?'junction':'dir');});assert.ok(r.failures.some(f=>typeof f==='object'&&f.reason.includes('symlinks')));});
