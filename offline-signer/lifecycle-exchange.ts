// Encrypted/public outputs only, after key worker exit. Never replaces a vault.
import {constants,type BigIntStats} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {safeDirectory} from '../core/files';
const allowed=new Set(['vault-encrypted.json','wallet-public.json','vault-backup.json','vault-multi-encrypted.json','wallet-multi-public.json','vault-multi-backup.json']);
const readFlags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
async function anchor(directory:string){
 if(process.platform!=='linux')throw Error('Lifecycle filesystem requires Linux. No fallback.');
 const path=resolve(directory);let handle=await open('/',readFlags|constants.O_DIRECTORY);
 try{
  for(const part of path.split('/').filter(Boolean)){const next=await open(`/proc/self/fd/${handle.fd}/${part}`,readFlags|constants.O_DIRECTORY);await handle.close();handle=next;}
  const identity=await handle.stat({bigint:true});
  const current=async()=>{await safeDirectory(path);const s=await lstat(path,{bigint:true});if(!s.isDirectory()||s.dev!==identity.dev||s.ino!==identity.ino)throw Error('Lifecycle directory changed.');};
  await current();return {handle,current,file:(name:string)=>{if(!allowed.has(name))throw Error('Unsupported lifecycle output.');return `/proc/self/fd/${handle.fd}/${name}`;}};
 }catch(e){await handle.close();throw e;}
}
const same=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&b.nlink===1n;
export async function lifecycleAbsent(directory:string,names:readonly string[]){
 const a=await anchor(directory);try{for(const name of names){try{await lstat(a.file(name));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}throw Error('Existing file will not be overwritten.');}await a.current();}finally{await a.handle.close();}
}
export async function writeLifecycleExclusive(directory:string,name:string,bytes:Buffer){
 if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>32768)throw Error('Lifecycle output exceeds bounds.');
 const a=await anchor(directory);
 try{
  await a.current();const target=a.file(name),file=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await a.handle.sync();await a.current();
  const check=await open(target,readFlags);
  try{
   const before=await check.stat({bigint:true});if(!before.isFile()||before.nlink!==1n||before.size!==BigInt(bytes.length))throw Error('Lifecycle publication verification failed.');
   const read=Buffer.alloc(bytes.length+1);let total=0;while(total<read.length){const r=await check.read(read,total,read.length-total,total);if(!r.bytesRead)break;total+=r.bytesRead;}
   if(!read.subarray(0,total).equals(bytes)||!same(before,await check.stat({bigint:true})))throw Error('Lifecycle publication changed.');
   await a.current();const named=await lstat(target,{bigint:true});if(!named.isFile()||named.isSymbolicLink()||!same(before,named))throw Error('Lifecycle publication name changed.');
  }finally{await check.close();}
 }finally{await a.handle.close();}
 // O_EXCL gives atomic non-replacement, not atomic content/multi-file publication.
 // A failed or interrupted new file stays preserved for manual recovery; never
 // delete by pathname after failure because a hostile process may replace it.
}
