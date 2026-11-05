'use strict';
// The OS owns exclusion. A killed parent closes the pipe and releases the lease;
// a stale filename never grants or indefinitely prevents spending authority.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
async function profileLock(dir){
 if(process.platform!=='win32')throw Error('Windows protected profile required.');
 if(fs.existsSync(path.join(dir,'operation.lock')))throw Error('Legacy operation lock exists; reconcile its owner before migration.');
 const target=path.join(dir,'operation.guard').replaceAll("'","''"),code=`$ErrorActionPreference='Stop';$s=$null;try{$s=[IO.FileStream]::new('${target}',[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);[Console]::Out.WriteLine('LOCKED');[Console]::Out.Flush();$null=[Console]::In.ReadToEnd()}catch{exit 2}finally{if($s){$s.Dispose()}}`,child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>{child.kill();reject(Error('Protected profile lock timeout.'));},10000),fail=()=>{clearTimeout(timer);reject(Error('Another protected operation owns the profile lock.'));};child.once('error',fail);child.once('exit',fail);child.stdout.on('data',b=>{output+=b;if(output==='LOCKED\r\n'||output==='LOCKED\n'){clearTimeout(timer);resolve();}else if(output.length>32){child.kill();fail();}});});
 let released=false;return async()=>{if(released)return;released=true;await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();reject(Error('Protected profile lease did not close.'));},10000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.stdin.end();});};
}
module.exports={profileLock};
