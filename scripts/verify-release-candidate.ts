// Read-only developer tool. Does not install, flash, modify rollback state or broadcast.
import {constants,createReadStream,type Stats} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseStrictPublicJson} from '../core/strict-public-json';
import {verifyReleaseCandidate} from '../core/release-auth';

const readFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const maximumJsonBytes = 65_536;
const maximumPayloadBytes = 8 * 1024 ** 3;
function unchanged(before:Stats,after:Stats):boolean {
 return after.isFile() && before.ino===after.ino && before.dev===after.dev && before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs;
}
async function publicJson(path:string){
 const full=resolve(path);if(await realpath(full)!==full)throw Error('Linked input is not accepted.');
 const before=await lstat(full);
 if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>maximumJsonBytes)throw Error('Invalid bounded public file.');
 // Nonblocking open prevents a regular-file-to-FIFO race from waiting for a writer.
 const handle=await open(full,readFlags);
 try{
  const start=await handle.stat();if(!unchanged(before,start))throw Error('Input changed while opening.');
  const buffer=Buffer.alloc(maximumJsonBytes+1);let total=0;
  while(total<buffer.length){
   const{bytesRead}=await handle.read(buffer,total,buffer.length-total,total);
   if(bytesRead===0)break;
   total+=bytesRead;
   if(total>maximumJsonBytes)throw Error('Public file exceeds its bounded size.');
  }
  const end=await handle.stat();
  if(total!==start.size||!unchanged(start,end))throw Error('Input changed while reading.');
  // Reject malformed UTF-8; replacement characters must not normalize hostile bytes.
  const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,total));
  return parseStrictPublicJson(text,maximumJsonBytes);
 }finally{await handle.close();}
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==4)throw Error('Usage: verify-release-candidate <signed-manifest.json> <independently-pinned-trust.json> <trusted-device-state.json> <payload>. Candidate verification only.');
 const [bundle,trust,state]=await Promise.all(args.slice(0,3).map(publicJson));
 const full=resolve(args[3]);if(await realpath(full)!==full)throw Error('Linked payload is not accepted.');
 const before=await lstat(full);
 if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>maximumPayloadBytes)throw Error('Payload is not a bounded regular file.');
 const handle=await open(full,readFlags);
 try{
  const start=await handle.stat();if(!unchanged(before,start))throw Error('Payload changed while opening.');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream('',{fd:handle.fd,autoClose:false})){
   bytes+=chunk.length;if(bytes>start.size||bytes>maximumPayloadBytes)throw Error('Payload grew while reading.');hash.update(chunk);
  }
  const end=await handle.stat();
  if(bytes!==start.size||!unchanged(start,end))throw Error('Payload changed while reading.');
  console.log(JSON.stringify(verifyReleaseCandidate(bundle,trust,state,{sha256:hash.digest('hex'),bytes}),null,2));
 }finally{await handle.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Candidate verification failed.');process.exitCode=1;});
