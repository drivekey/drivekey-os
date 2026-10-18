import {describe,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {releaseSigningBytes} from '../core/release-auth';
let directory:string,args:string[],tool:string,originals:Buffer[];
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'drivekey-release-test-'));tool=join(directory,'verify.cjs');
 await build({entryPoints:['scripts/verify-release-candidate.ts'],outfile:tool,bundle:true,platform:'node',target:'node22',format:'cjs'});
 const payload=Buffer.from('Synthetic unfunded candidate bytes'),now=Date.now();
 const manifest={kind:'drivekey-authenticated-release',version:1,product:'drivekey-hardware',hardwareRevision:'prototype-a',channel:'candidate',releaseVersion:'0.1.0',sequence:2,minimumBootVersion:1,payloadBytes:payload.length,payloadSha256:createHash('sha256').update(payload).digest('hex'),sourceSha256:'34'.repeat(32),createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString()};
 const keys=Array.from({length:3},()=>generateKeyPairSync('ed25519'));
 const trust={product:'drivekey-hardware',hardwareRevision:'prototype-a',allowProduction:false,keys:keys.map((k,i)=>({keyId:'release-'+i,publicKeyPem:k.publicKey.export({type:'spki',format:'pem'}).toString()}))};
 const approvals=keys.slice(0,2).map((k,i)=>({keyId:'release-'+i,signature:sign(null,releaseSigningBytes(manifest),k.privateKey).toString('base64')}));
 args=['manifest.json','trust.json','state.json','payload.bin'].map(p=>join(directory,p));
 originals=[Buffer.from(JSON.stringify({manifest,approvals})),Buffer.from(JSON.stringify(trust)),Buffer.from(JSON.stringify({installedSequence:1,bootVersion:1})),payload];
});
beforeEach(async()=>{await Promise.all(args.map((path,index)=>writeFile(path,originals[index])));});
afterAll(async()=>{const target=resolve(directory);if(target.startsWith(resolve(tmpdir())+sep+'drivekey-release-test-'))await rm(target,{recursive:true,force:true});});
function invoke(preload?:string){
 return spawnSync(process.execPath,[...(preload?['--require',preload]:[]),tool,...args],{encoding:'utf8',windowsHide:true,timeout:8000});
}
function rejected(result:ReturnType<typeof invoke>,message?:RegExp){
 expect(result.error).toBeUndefined(); // A rejection must terminate, not hit the test timeout.
 expect(result.status).toBe(1);expect(result.stdout).toBe('');
 if(message)expect(result.stderr).toMatch(message);
}
// Test-only preload interposes actual FileHandles. Production remains an ordinary
// CLI, with no injected reader, alternate trust source, or test bypass parameter.
async function hook(mode:'short'|'prefix'|'timestamp'|'nonregular-json'|'nonregular-payload'|'flags'|'growth'){
 const path=join(directory,'io-hook.cjs');
 await writeFile(path,`
 const fs=require('node:fs/promises'), {constants}=require('node:fs'), {basename}=require('node:path');
 const mode=${JSON.stringify(mode)},originalOpen=fs.open;
 fs.open=async function(path,flags,...rest){
   if(mode==='flags' && constants.O_NONBLOCK && !(flags & constants.O_NONBLOCK))throw Error('NONBLOCK missing');
   const handle=await originalOpen.call(this,path,flags,...rest),name=basename(String(path));
   if((mode==='nonregular-json'&&name==='state.json')||(mode==='nonregular-payload'&&name==='payload.bin')){
     const stat=handle.stat.bind(handle);handle.stat=async()=>{const value=await stat();value.isFile=()=>false;return value;};
   }
   if(name==='state.json' && ['short','prefix','timestamp','growth'].includes(mode)){
     const read=handle.read.bind(handle);let calls=0;
     handle.read=async function(buffer,offset,length,position){
       const chunk=mode==='prefix'?${originals[2].length}:mode==='short'?7:4096;
       const result=await read(buffer,offset,Math.min(length,chunk),position);
       if(++calls===1&&mode==='timestamp')await fs.utimes(path,new Date(0),new Date(1000));
       if(calls===1&&mode==='growth')await fs.appendFile(path,' '.repeat(65537));
       return result;
     };
   }
   return handle;
 };
 `);
 return path;
}

describe.sequential('read-only candidate verifier',()=>{
 it('hashes real payload bytes and reports authentication without install authority',()=>{
  const result=invoke();expect(result.error).toBeUndefined();expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({status:'candidate-authenticated',installationAuthorized:false});
 });
 it('rejects payload replacement instead of accepting manifest-declared hash alone',async()=>{
  await writeFile(args[3],'Changed payload');rejected(invoke(),/Release payload differs/);
 });
 it('opens both public files and payload nonblocking where supported',async()=>{
  const result=invoke(await hook('flags'));expect(result.status).toBe(0);
 });
 it('fully consumes short regular-file reads',async()=>{
  const result=invoke(await hook('short'));expect(result.status).toBe(0);
 });
 it('rejects trailing data even when reads stop at a valid JSON prefix',async()=>{
  await writeFile(args[2],Buffer.concat([originals[2],Buffer.from(' {}')]));
  rejected(invoke(await hook('prefix')),/Unexpected data after JSON/);
 });
 it('rejects malformed UTF-8 instead of silently replacing its bytes',async()=>{
  await writeFile(args[2],Buffer.concat([Buffer.from('{"installedSequence":1,"bootVersion":1,"extra":"'),Buffer.from([0xff]),Buffer.from('"}')]));
  rejected(invoke(),/encoded data was not valid|encoding|UTF-8/i);
 });
 it('rejects changes to metadata during descriptor reads',async()=>{
  rejected(invoke(await hook('timestamp')),/Input changed while reading/);
 });
 it('rejects public files that grow beyond the read cap',async()=>{
  rejected(invoke(await hook('growth')),/bounded size/);
 });
 it.each(['nonregular-json','nonregular-payload'] as const)('rejects a non-regular opened descriptor: %s',async mode=>{
  rejected(invoke(await hook(mode)),/changed while opening/);
 });
});
