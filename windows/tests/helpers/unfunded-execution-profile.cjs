'use strict';
// Fresh CurrentUser-only fixture namespaces outside source and deliverables.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
function protect(mode,bytes){
  const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[IO.MemoryStream]::new();[Console]::OpenStandardInput().CopyTo($s);$b=$s.ToArray();try{$r=[Security.Cryptography.ProtectedData]::"+mode+"($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($r,0,$r.Length)}finally{[Array]::Clear($b,0,$b.Length);[Array]::Clear($s.GetBuffer(),0,$s.Capacity);if($r){[Array]::Clear($r,0,$r.Length)};$s.Dispose()}";
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{input:bytes,windowsHide:true,timeout:15000,maxBuffer:2*1024*1024,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot}});
  if(result.status!==0||!result.stdout?.length)throw Error('Unfunded fixture protection failed.');return result.stdout;
}
function directory(id){if(process.platform!=='win32'||!process.env.LOCALAPPDATA||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw Error('Invalid protected fixture profile.');return path.join(process.env.LOCALAPPDATA,'DriveKeyAcceptance','UnfundedExecutionFixtures',id);}
function createProfile(){const id=randomUUID(),dir=directory(id);fs.mkdirSync(dir,{recursive:true});const who=spawnSync('whoami.exe',[],{encoding:'utf8',windowsHide:true});if(who.status!==0)throw Error('Cannot determine fixture account.');const acl=spawnSync('icacls.exe',[dir,'/inheritance:r','/grant:r',who.stdout.trim()+':(OI)(CI)F'],{encoding:'utf8',windowsHide:true});if(acl.status!==0)throw Error('Cannot restrict fixture profile.');return {id,directory:dir};}
function persist(profile,name,value){if(!/^[a-z0-9-]+\.dpapi$/.test(name))throw Error('Invalid fixture record.');const plaintext=Buffer.from(JSON.stringify(value));try{fs.writeFileSync(path.join(profile.directory,name),protect('Protect',plaintext),{flag:'wx',mode:0o600});}finally{plaintext.fill(0);}}
function loadEnrollment(id){const plaintext=protect('Unprotect',fs.readFileSync(path.join(directory(id),'enrollment.dpapi')));try{return JSON.parse(plaintext);}finally{plaintext.fill(0);}}
module.exports={createProfile,directory,persist,loadEnrollment};
