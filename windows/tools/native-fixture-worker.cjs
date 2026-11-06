'use strict';
// Secrets are confined to this isolated test broker and the original packaged
// offline worker's stdin. Never send an unlock secret to main, renderer or argv.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAILURE='Protected unfunded fixture signer rejected the operation. Preserve its files.';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function readBounded(file,limit){const handle=await fs.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>limit)throw Error(FAILURE);const bytes=Buffer.alloc(limit+1),r=await handle.read(bytes,0,bytes.length,0);if(r.bytesRead!==stat.size||r.bytesRead>limit){bytes.fill(0);throw Error(FAILURE);}return bytes.subarray(0,r.bytesRead);}finally{await handle.close();}}
async function dpapi(method,input){
 if(process.platform!=='win32'||!process.env.SystemRoot||!['Protect','Unprotect'].includes(method))throw Error(FAILURE);
 const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[IO.MemoryStream]::new();[Console]::OpenStandardInput().CopyTo($s);$b=$s.ToArray();try{$r=[Security.Cryptography.ProtectedData]::"+method+"($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($r,0,$r.Length)}finally{[Array]::Clear($b,0,$b.Length);[Array]::Clear($s.GetBuffer(),0,$s.Capacity);if($r){[Array]::Clear($r,0,$r.Length)};$s.Dispose()}";
 const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot},stdio:['pipe','pipe','ignore']});
 const parts=[];let size=0;child.stdout.on('data',b=>{size+=b.length;if(size>65536){b.fill(0);child.kill();}else parts.push(b);});
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);child.stdin.on('error',()=>{});child.stdin.end(input);});if(code!==0||size<1||size>65536)throw Error(FAILURE);return Buffer.concat(parts);}catch{throw Error(FAILURE);}finally{for(const b of parts)b.fill(0);}
}
async function protectedRecord(directory,name,unprotect){const file=path.join(directory,name);if((await fs.lstat(file)).isSymbolicLink())throw Error(FAILURE);const cipher=await readBounded(file,65536);let plain;try{plain=await unprotect(cipher);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{cipher.fill(0);plain?.fill(0);}}
async function checkedCredential(envelope,{localAppData=process.env.LOCALAPPDATA,unprotect=b=>dpapi('Unprotect',b)}={}){
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
async function run(envelope,worker){
 const secret=await checkedCredential(envelope);let input;
 try{
  if(typeof worker!=='string'||!path.isAbsolute(worker)||path.basename(worker)!=='worker.cjs')throw Error(FAILURE);
  input={...envelope.input,password:secret.password};
  // The original worker includes the offline network guard. Execute in this
  // process so native cancellation terminates the only signing process.
  const {executeOfflineJob}=require(worker);if(typeof executeOfflineJob!=='function')throw Error(FAILURE);
  return {ok:true,result:await executeOfflineJob(input)};
 }finally{secret.password=undefined;if(input)input.password=undefined;}
}
module.exports={checkedCredential,dpapi,run,digest,FAILURE};
if(require.main===module){const parts=[];let size=0;process.stdin.on('data',b=>{size+=b.length;if(size>256*1024){b.fill(0);for(const p of parts)p.fill(0);process.exit(2);}parts.push(b);});process.stdin.on('end',async()=>{let raw;try{raw=Buffer.concat(parts);const envelope=JSON.parse(raw.toString('utf8'));raw.fill(0);for(const p of parts)p.fill(0);process.stdout.write(JSON.stringify(await run(envelope,process.argv[2])));}catch{process.stdout.write(JSON.stringify({ok:false,error:FAILURE}));process.exitCode=1;}finally{raw?.fill(0);for(const p of parts)p.fill(0);}});}
