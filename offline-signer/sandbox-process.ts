// Linux OS confinement is mandatory. Node permissions alone are not a sandbox.
import {spawn} from 'node:child_process';
import {lstat,realpath,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
export type SandboxProgram={node:string;program:string;args:readonly string[];inputLimit:number;outputLimit:number;timeoutMs:number;heapMb:number};
export function validateCrashPattern(pattern:string){
 // Linux pipe collectors ignore RLIMIT_CORE and run outside our namespaces.
 if(!pattern.trim()||pattern.length>256||pattern.includes('\0')||pattern.trimStart().startsWith('|'))throw Error('Host crash collectors are not permitted for isolated signing.');
}
async function trustedPath(path:string,directory=false){
 if(!path.startsWith('/')||resolve(path)!==path||await realpath(path)!==path)throw Error('Sandbox path is not an absolute real path.');
 let current=path;
 while(true){const s=await lstat(current);if(s.uid!==0||(s.mode&0o022)!==0||s.isSymbolicLink()||((current!==path||directory)?!s.isDirectory():!s.isFile()))throw Error('Sandbox runtime must be root-owned and not writable by other users.');
  if(current==='/')break;current=dirname(current);}
}
export function sandboxArguments(program:SandboxProgram){
 if(!Number.isSafeInteger(program.heapMb)||program.heapMb<32||program.heapMb>256||program.args.length>1||program.args.some(a=>!['setup','vault','expectation','action','trade-route','lifi-request','husher-route','husher-request','robinhood-request','robinhood-vault','eth-native-route','eth-native-request','jupiter-route','jupiter-request','jupiter-expiring-route','jupiter-expiring-request','nonce-control-route','nonce-control-request','lifecycle-v2','lifecycle-v3','nonce-route','nonce-request','multi-request','eth-trade-route','eth-trade-request','rules-context','rules-draft','rules-approval'].includes(a)))throw Error('Unsupported sandbox policy.');
 return ['--as=1610612736','--cpu=30','--core=0','--fsize=0','--nofile=64','--nproc=64','--','/usr/bin/bwrap',
  '--unshare-all','--unshare-user','--disable-userns','--die-with-parent','--new-session','--cap-drop','ALL','--uid','65534','--gid','65534',
  '--clearenv','--setenv','LANG','C','--setenv','HOME','/nonexistent','--hostname','drivekey-isolated',
  '--ro-bind','/usr/lib','/usr/lib','--ro-bind','/usr/lib64','/usr/lib64','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
  '--ro-bind',program.node,'/runtime/node','--ro-bind',program.program,'/worker.cjs','--proc','/proc','--dev','/dev','--chdir','/',
  '--','/runtime/node','--jitless','--no-addons',`--max-old-space-size=${program.heapMb}`,'/worker.cjs',...program.args];
}
export async function runSandbox(program:SandboxProgram,input:Buffer):Promise<Buffer>{
 return runBoundedSandbox(program,input,32768);
}
// Separate fixed profile for PUBLIC proof bytes only. Secret/parser callers keep
// their existing 32 KiB ceiling; no IPC field can select this larger profile.
export const PUBLIC_PROOF_SANDBOX_LIMITS=Object.freeze({inputLimit:1048576,outputLimit:16384,timeoutMs:20000,heapMb:64});
export async function runPublicProofSandbox(program:{node:string;program:string},input:Buffer):Promise<Buffer>{
 return runBoundedSandbox({node:program.node,program:program.program,args:[],...PUBLIC_PROOF_SANDBOX_LIMITS},input,PUBLIC_PROOF_SANDBOX_LIMITS.inputLimit);
}
async function runBoundedSandbox(program:SandboxProgram,input:Buffer,maximumInput:number):Promise<Buffer>{
 if(process.platform!=='linux')throw Error('The isolated signer requires Linux sandbox support. No fallback is permitted.');
 validateCrashPattern(await readFile('/proc/sys/kernel/core_pattern','utf8'));
 if(![program.inputLimit,program.outputLimit,program.timeoutMs].every(Number.isSafeInteger)||program.inputLimit<1||program.outputLimit<1||input.length>program.inputLimit||program.inputLimit>maximumInput||program.outputLimit>32768||program.timeoutMs<1||program.timeoutMs>90000)throw Error('Invalid sandbox limits.');
 for(const path of ['/usr/bin/prlimit','/usr/bin/bwrap',program.node,program.program])await trustedPath(path);
 for(const path of ['/usr/lib','/usr/lib64'])await trustedPath(path,true);
 const args=sandboxArguments(program);
 return new Promise((resolveResult,reject)=>{
  // A root-launched live desktop must not leave workers mapped to host UID 0:
  // Linux exempts that UID from RLIMIT_NPROC. Drop host identity before bwrap.
  const dropRoot=process.getuid?.()===0;
  const child=spawn('/usr/bin/prlimit',args,{cwd:'/',env:{NODE_ENV:'production'},stdio:['pipe','pipe','pipe'],detached:true,windowsHide:true,
   ...(dropRoot?{uid:65534,gid:65534}:{})});
  let settled=false,total=0,errorBytes=0,failure:string|undefined;const chunks:Buffer[]=[];
  const stop=()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}};
  // Killing is asynchronous: never return to the broker before close/reap.
  const fail=(message:string)=>{if(settled||failure)return;failure=message;clearTimeout(timer);stop();};
  const timer=setTimeout(()=>fail('Isolated worker timed out.'),program.timeoutMs);
  child.on('error',()=>fail('Isolated worker could not start.'));
  child.stdin.on('error',()=>fail('Isolated worker pipe failed.'));
  child.stdout.on('data',(b:Buffer)=>{total+=b.length;if(total>program.outputLimit)fail('Isolated worker output exceeds limit.');else chunks.push(Buffer.from(b));});
  // Do not propagate untrusted parser diagnostics or key-process stderr to the UI.
  child.stderr.on('data',(b:Buffer)=>{errorBytes+=b.length;if(errorBytes>4096)fail('Isolated worker diagnostics exceed limit.');});
  child.on('close',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);if(failure)reject(Error(failure));else if(code!==0||signal||!total)reject(Error('Isolated worker rejected the input or confinement failed.'));else resolveResult(Buffer.concat(chunks));});
  child.stdin.end(input);
 });
}
