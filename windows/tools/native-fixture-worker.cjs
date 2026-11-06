'use strict';
// Secrets are confined to this isolated test broker and the original packaged
// offline worker's stdin. Never send an unlock secret to main, renderer or argv.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAILURE='Protected unfunded fixture signer rejected the operation. Preserve its files.';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function readBounded(file,limit){const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error(FAILURE);const handle=await fs.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.dev!==before.dev||stat.ino!==before.ino||stat.size!==before.size||stat.size<1||stat.size>limit)throw Error(FAILURE);const bytes=Buffer.alloc(limit+1),r=await handle.read(bytes,0,bytes.length,0),after=await handle.stat();if(r.bytesRead!==stat.size||r.bytesRead>limit||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs){bytes.fill(0);throw Error(FAILURE);}return bytes.subarray(0,r.bytesRead);}finally{await handle.close();}}
async function dpapi(method,input){
 if(process.platform!=='win32'||!process.env.SystemRoot||!['Protect','Unprotect'].includes(method))throw Error(FAILURE);
 const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[IO.MemoryStream]::new();[Console]::OpenStandardInput().CopyTo($s);$b=$s.ToArray();try{$r=[Security.Cryptography.ProtectedData]::"+method+"($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($r,0,$r.Length)}finally{[Array]::Clear($b,0,$b.Length);[Array]::Clear($s.GetBuffer(),0,$s.Capacity);if($r){[Array]::Clear($r,0,$r.Length)};$s.Dispose()}";
 const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot},stdio:['pipe','pipe','ignore']});
 const parts=[];let size=0;child.stdout.on('data',b=>{size+=b.length;if(size>65536){b.fill(0);child.kill();}else parts.push(b);});
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);child.stdin.on('error',()=>{});child.stdin.end(input);});if(code!==0||size<1||size>65536)throw Error(FAILURE);return Buffer.concat(parts);}catch{throw Error(FAILURE);}finally{for(const b of parts)b.fill(0);}
}
async function protectedRecord(directory,name,unprotect){const file=path.join(directory,name);if((await fs.lstat(file)).isSymbolicLink())throw Error(FAILURE);const cipher=await readBounded(file,65536);let plain;try{plain=await unprotect(cipher);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{cipher.fill(0);plain?.fill(0);}}
async function checkedLegacyCredential(envelope,{localAppData=process.env.LOCALAPPDATA,unprotect=b=>dpapi('Unprotect',b)}={}){
 const {metadata,input}=envelope||{};
 if(!metadata||Object.keys(metadata).sort().join(',')!=='baseSourceFingerprint,mode,profileId,version'||metadata.version!==1||metadata.mode!=='unfunded-local-solana'||!UUID.test(metadata.profileId)||typeof metadata.baseSourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(metadata.baseSourceFingerprint)||!localAppData||!path.isAbsolute(localAppData)||!input||!['verify','sign'].includes(input.action)||Object.keys(input).some(k=>!['action','vault','password','request','fingerprint'].includes(k))||input.password?.fixtureProfileId!==metadata.profileId||Object.keys(input.password).join(',')!=='fixtureProfileId')throw Error(FAILURE);
 // Resolve only a fixed OS-local namespace. No renderer-supplied path is used.
 const base=await fs.realpath(localAppData),namespace=path.join(base,'DriveKeyAcceptance'),fixtures=path.join(namespace,'UnfundedNativeFixtures'),directory=path.join(fixtures,metadata.profileId);
 for(const dir of [namespace,fixtures,directory]){const s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error(FAILURE);}
 const scope=await protectedRecord(directory,'scope.dpapi',unprotect);
 if(scope?.version!==1||scope.fixtureOnly!==true||scope.profileId!==metadata.profileId||scope.sourceFingerprint!==metadata.baseSourceFingerprint||scope.deviceId!==input.vault?.public?.deviceId||scope.vaultDigest!==digest(input.vault)||!Array.isArray(scope.requests)||scope.requests.length<1||scope.requests.length>3||scope.requests.some(r=>!r||Object.keys(r).sort().join(',')!=='fingerprint,requestDigest'||!/^0x[0-9a-f]{64}$/.test(r.fingerprint)||!/^[0-9a-f]{64}$/.test(r.requestDigest))||new Set(scope.requests.map(r=>r.fingerprint)).size!==scope.requests.length)throw Error(FAILURE);
 if(input.action==='sign'){
  const r=input.request;
  if(r?.version!==8||r.action!=='payment'||r.chain!=='solana'||r.network!=='solana'||!['SOL','USDC'].includes(r.asset)||r.deviceId!==scope.deviceId||input.fingerprint!==r.fingerprint||!scope.requests.some(row=>row.fingerprint===r.fingerprint&&row.requestDigest===digest(r)))throw Error(FAILURE);
 }
 const secret=await protectedRecord(directory,'unlock.dpapi',unprotect);
 if(secret?.version!==1||secret.fixtureOnly!==true||secret.profileId!==metadata.profileId||secret.deviceId!==scope.deviceId||secret.vaultDigest!==scope.vaultDigest||typeof secret.password!=='string'||secret.password.length<16||secret.password.length>256)throw Error(FAILURE);
 return secret;
}
function snapshotEnvelope(envelope){const text=JSON.stringify(envelope);if(typeof text!=='string'||Buffer.byteLength(text)>256*1024)throw Error(FAILURE);const copy=JSON.parse(text);if(!copy||Object.keys(copy).sort().join(',')!=='input,metadata')throw Error(FAILURE);return copy;}
async function checkedScopedCredential(envelope,{localAppData=process.env.LOCALAPPDATA,unprotect=b=>dpapi('Unprotect',b),worker}={}){
 const {metadata,input}=envelope,scopeApi=require('./native-offline-scope.cjs');
 if(!metadata||Object.keys(metadata).sort().join(',')!=='baseSourceFingerprint,mode,profileId,version'||metadata.version!==2||metadata.mode!=='unfunded-scoped-offline'||!UUID.test(metadata.profileId)||!/^[0-9a-f]{64}$/.test(metadata.baseSourceFingerprint)||!localAppData||!path.isAbsolute(localAppData)||typeof worker!=='string'||!path.isAbsolute(worker)||!scopeApi.knownJob(path.basename(worker),input)||!input||typeof input!=='object'||Array.isArray(input))throw Error(FAILURE);
 const name=path.basename(worker),fields=name==='product-proof-worker.cjs'?['action','vault','password','request','response','artifactDirectory']:['action','vault','password','request','fingerprint','wallet','manifest','page','noteManifestFingerprint'];
 if(Object.keys(input).some(key=>!fields.includes(key)))throw Error(FAILURE);
 const keyBearing=scopeApi.keyBearing(name,input);
 if(keyBearing?input.password?.fixtureProfileId!==metadata.profileId||Object.keys(input.password).join(',')!=='fixtureProfileId':input.password!==undefined)throw Error(FAILURE);
 const base=await fs.realpath(localAppData),namespace=path.join(base,'DriveKeyAcceptance'),fixtures=path.join(namespace,'UnfundedNativeIntentFixtures'),directory=path.join(fixtures,metadata.profileId);
 for(const dir of [namespace,fixtures,directory]){const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(FAILURE);}
 const scope=await protectedRecord(directory,'scope.dpapi',unprotect),workerHash=createHash('sha256').update(await fs.readFile(worker)).digest('hex');scopeApi.validateScope(scope,metadata,input,name,workerHash);
 if(name==='product-proof-worker.cjs'){const check=require(worker).verifyProductProofJobAuthorization;if(typeof check!=='function')throw Error(FAILURE);await check(input.request,input.response,input.vault.public);}
 let secret={};
 if(keyBearing){secret=await protectedRecord(directory,'unlock.dpapi',unprotect);if(Object.keys(secret).sort().join(',')!=='deviceId,fixtureOnly,password,profileId,vaultDigest,version'||secret.version!==2||secret.fixtureOnly!==true||secret.profileId!==metadata.profileId||secret.deviceId!==scope.deviceId||secret.vaultDigest!==scope.vaultDigest||typeof secret.password!=='string'||secret.password.length<16||secret.password.length>256)throw Error(FAILURE);}
 Object.defineProperty(secret,'executionPolicy',{value:scopeApi.executionPolicy(input),enumerable:false});return secret;
}
async function checkedCredential(envelope,options){const copy=snapshotEnvelope(envelope);return copy.metadata?.version===2?checkedScopedCredential(copy,options):checkedLegacyCredential(copy,options);}
function installOfflineGuard(){const deny=()=>{throw Error('Networking is disabled in the offline fixture broker.');};globalThis.fetch=deny;for(const [name,methods]of [['node:http',['request','get']],['node:https',['request','get']],['node:http2',['connect']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dgram',['createSocket']],['node:dns',['lookup','resolve','resolve4','resolve6']]]){const module=require(name);for(const method of methods)module[method]=deny;}require('node:net').Socket.prototype.connect=deny;for(const method of ['lookup','resolve','resolve4','resolve6'])require('node:dns').promises[method]=deny;if('WebSocket' in globalThis)globalThis.WebSocket=class{constructor(){deny();}};}
async function run(envelope,worker){
 if(typeof worker!=='string'||!path.isAbsolute(worker)||!['worker.cjs','product-proof-worker.cjs'].includes(path.basename(worker)))throw Error(FAILURE);
 const copy=snapshotEnvelope(envelope);if(copy.metadata?.version!==2&&path.basename(worker)!=='worker.cjs')throw Error(FAILURE);
 installOfflineGuard();const secret=await checkedCredential(copy,{worker});let input;
 try{
  input={...copy.input,...(secret.password===undefined?{}:{password:secret.password})};
  // The original worker includes the offline network guard. Execute in this
  // process so native cancellation terminates the only signing process.
  const dispatcher=require(worker),execute=path.basename(worker)==='worker.cjs'?dispatcher.executeOfflineJob:dispatcher.executeProductProofJob;if(typeof execute!=='function')throw Error(FAILURE);
  return {ok:true,result:await execute(input,secret.executionPolicy)};
 }finally{secret.password=undefined;if(input)input.password=undefined;}
}
module.exports={checkedCredential,dpapi,run,digest,FAILURE};
if(require.main===module){const parts=[];let size=0;process.stdin.on('data',b=>{size+=b.length;if(size>256*1024){b.fill(0);for(const p of parts)p.fill(0);process.exit(2);}parts.push(b);});process.stdin.on('end',async()=>{let raw;try{raw=Buffer.concat(parts);const envelope=JSON.parse(raw.toString('utf8'));raw.fill(0);for(const p of parts)p.fill(0);process.stdout.write(JSON.stringify(await run(envelope,process.argv[2])));}catch{process.stdout.write(JSON.stringify({ok:false,error:FAILURE}));process.exitCode=1;}finally{raw?.fill(0);for(const p of parts)p.fill(0);}});}
