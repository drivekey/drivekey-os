import {constants,type Stats} from 'node:fs';
import {lstat,open,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeDirectory} from '../core/files';
function same(a:Stats,b:Stats){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
const flags=constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);
async function openExchangeDirectory(directory:string){
 if(process.platform!=='linux')throw Error('Pinned exchange operations require Linux. No fallback is permitted.');
 const dir=resolve(directory);let handle=await open('/',flags|constants.O_DIRECTORY);
 try{
  // Pin every component; O_NOFOLLOW on only the final directory is insufficient.
  for(const component of dir.split('/').filter(Boolean)){
   const next=await open(`/proc/self/fd/${handle.fd}/${component}`,flags|constants.O_DIRECTORY);
   await handle.close();handle=next;
  }
  const identity=await handle.stat();
  const assertCurrent=async()=>{await safeDirectory(dir);const current=await lstat(dir);if(!current.isDirectory()||current.dev!==identity.dev||current.ino!==identity.ino)throw Error('Exchange directory changed.');};
  await assertCurrent();return {handle,assertCurrent,path:(name:string)=>`/proc/self/fd/${handle.fd}/${name}`};
 }catch(error){await handle.close();throw error;}
}
/** Raw bytes only: decoding/parsing is delegated before any key worker starts. */
export async function readBoundedExchangeBytes(directory:string,filename:string){
 if(!/^[a-z0-9-]+\.json$/.test(filename))throw Error('Invalid exchange filename.');
 const anchor=await openExchangeDirectory(directory);
 try{
  // The Linux proc-fd anchor keeps the parent directory fixed during path lookup.
  const path=anchor.path(filename);
  const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<1||before.size>32768)throw Error('Invalid bounded exchange file.');
  const handle=await open(path,flags);
  try{
   const start=await handle.stat();if(!start.isFile()||!same(before,start)||start.nlink!==1)throw Error('Exchange file changed while opening.');
   const bytes=Buffer.alloc(32769);let total=0;
   while(total<bytes.length){const result=await handle.read(bytes,total,bytes.length-total,total);if(!result.bytesRead)break;total+=result.bytesRead;if(total>32768)throw Error('Exchange file exceeds limit.');}
   const end=await handle.stat();
   if(total!==start.size||!same(start,end)||end.nlink!==1)throw Error('Exchange input changed while reading.');
   await anchor.assertCurrent();
   return bytes.subarray(0,total);
  }finally{await handle.close();}
 }finally{await anchor.handle.close();}
}

/** Public proof output only. The signer has exited before this operation starts. */
export async function writeBoundedExchangeBytes(directory:string,filename:string,bytes:Buffer){
 if(!/^[a-z0-9-]+\.json$/.test(filename)||bytes.length<1||bytes.length>32768)throw Error('Invalid bounded exchange output.');
 const anchor=await openExchangeDirectory(directory),temp=anchor.path(`.drivekey-${randomUUID()}.tmp`),target=anchor.path(filename);
 let published=false;
 try{
  const existing=await lstat(target).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;});
  if(existing&&(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1))throw Error('Refusing linked or special output.');
  const file=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await anchor.assertCurrent();await rename(temp,target);published=true;await anchor.handle.sync();
  const fileCheck=await open(target,flags);
  try{
   const before=await fileCheck.stat();if(!before.isFile()||before.nlink!==1||before.size!==bytes.length)throw Error('Output verification failed.');
   const actual=Buffer.alloc(bytes.length+1);let total=0;
   while(total<actual.length){const r=await fileCheck.read(actual,total,actual.length-total,total);if(!r.bytesRead)break;total+=r.bytesRead;}
   if(!same(before,await fileCheck.stat())||!actual.subarray(0,total).equals(bytes))throw Error('Output verification failed.');
   await anchor.assertCurrent();
   // A valid held FD does not prove the requested filename still names that file.
   const named=await lstat(target);
   if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1||!same(before,named))throw Error('Output changed during verification.');
  }finally{await fileCheck.close();}
 }finally{if(!published)await unlink(temp).catch(()=>{});await anchor.handle.close();}
}
