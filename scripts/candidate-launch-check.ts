import {execFileSync, type ExecFileSyncOptions} from 'node:child_process';

type Runner=(file:string,args:string[],options:ExecFileSyncOptions)=>unknown;
export const CANDIDATE_LAUNCH_TIMEOUT_MS=15000;

export type CandidateLaunchProgress={stage:'manifest'|'entries'|'inventory'|'markers'|'environment'|'complete';entries:number;bytes:number;elapsedMs:number};
// Only canonical, bounded, monotonic aggregate lines are public diagnostics.
// Invalid, partial, duplicate-key or noisy output is discarded in full.
export function parseCandidateLaunchProgress(value:unknown):CandidateLaunchProgress|undefined {
 try {
  if(!Buffer.isBuffer(value)&&typeof value!=='string')return;
  if(Buffer.byteLength(value)>4096)return;
  const text=typeof value==='string'?value:new TextDecoder('utf-8',{fatal:true}).decode(value);
  if(!text.endsWith('\n'))return;
  const lines=text.slice(0,-1).split('\n');if(lines.length<1||lines.length>16)return;
  const stages=['manifest','entries','inventory','markers','environment','complete'];
  let previous:CandidateLaunchProgress|undefined;
  for(const line of lines){
   const item=JSON.parse(line);
   if(!item||Array.isArray(item)||JSON.stringify(item)!==line||Object.keys(item).join(',')!=='stage,entries,bytes,elapsedMs')return;
   if(!stages.includes(item.stage)||!['entries','bytes','elapsedMs'].every(k=>Number.isSafeInteger(item[k])&&item[k]>=0)||item.entries>20000)return;
   if(!previous&&(item.stage!=='manifest'||item.entries!==0||item.bytes!==0))return;
   if(previous&&(stages.indexOf(item.stage)<stages.indexOf(previous.stage)||item.entries<previous.entries||item.bytes<previous.bytes||item.elapsedMs<previous.elapsedMs))return;
   previous={stage:item.stage,entries:item.entries,bytes:item.bytes,elapsedMs:item.elapsedMs};
  }
  return previous;
 }catch{return;}
}

// Public diagnostics only: never return the child output, error message or
// command input. Only strict aggregate progress may be included on failure.
// The launch policy is still required before stdin is read.
export function candidateLaunchCheck(run:Runner=(file,args,options)=>execFileSync(file,args,options)) {
 const start=performance.now();
 let failure:'none'|'timeout'|'output-limit'|'unavailable'|'rejected'='none';
 let progress:CandidateLaunchProgress|undefined;
 try {
  run('/usr/bin/python3',['-I','-B','/opt/drivekey/drivekey-candidate-policy.py','--check'],
   {env:{LANG:'C',NODE_ENV:'production'},cwd:'/',timeout:CANDIDATE_LAUNCH_TIMEOUT_MS,maxBuffer:8192,stdio:['ignore','pipe','pipe']});
 } catch(error) {
  const code=(error as NodeJS.ErrnoException|null)?.code;
  progress=parseCandidateLaunchProgress((error as {stderr?:unknown}|null)?.stderr);
  failure=code==='ETIMEDOUT'?'timeout':code==='ENOBUFS'?'output-limit':code==='ENOENT'?'unavailable':'rejected';
 }
 return {passed:failure==='none',failure,elapsedMs:Math.max(0,Math.round(performance.now()-start)),timeoutMs:CANDIDATE_LAUNCH_TIMEOUT_MS,...(progress?{progress}:{})};
}

export function candidateLaunchFailureMessage(failure:string) {
 return failure==='timeout'
  ? 'The startup integrity check timed out before reading a command. No request was processed.'
  : 'The startup integrity check did not pass. No command was read or processed.';
}

