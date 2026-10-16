// Byte correspondence for a trusted local artifact, not release authentication.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function verifiedLocalArtifact(path:string,bytes:number,sha256:string){
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>600*1024*1024||! /^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid artifact expectation');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let owned=true,streamStarted=false;
 const close=async()=>{if(owned){owned=false;await file.close();}};
 try{const initial=await file.stat({bigint:true});if(!initial.isFile()||initial.size!==BigInt(bytes))throw Error('Artifact size/type mismatch');
 const unchanged=async()=>{const s=await file.stat({bigint:true});if(!s.isFile()||s.size!==initial.size||s.dev!==initial.dev||s.ino!==initial.ino||s.mtimeNs!==initial.mtimeNs||s.ctimeNs!==initial.ctimeNs)throw Error('Artifact changed');};
 const chunkSize=1024*1024,chunkHashes:string[]=[],hash=createHash('sha256'),buffer=Buffer.allocUnsafe(chunkSize);let position=0;while(position<bytes){const length=Math.min(buffer.length,bytes-position);const {bytesRead}=await file.read(buffer,0,length,position);if(bytesRead!==length)throw Error('Artifact truncated');const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);chunkHashes.push(createHash('sha256').update(chunk).digest('hex'));position+=bytesRead;}await unchanged();if(hash.digest('hex')!==sha256)throw Error('Artifact digest mismatch');
 return {close,stream(start:number,end:number){
  if(!owned||streamStarted||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=bytes)throw Error('Invalid range');
  streamStarted=true;let offset=start,finished=false;
  // Propagate verification errors directly to the response stream. This avoids the
  // Node-to-Web adapter path that returned an empty successful body in regression tests.
  return new ReadableStream<Uint8Array>({
   async pull(controller){
    if(finished)return;
    try{
     await unchanged();
     const chunkIndex=Math.floor(offset/chunkSize),chunkStart=chunkIndex*chunkSize;
     const block=Buffer.allocUnsafe(Math.min(chunkSize,bytes-chunkStart));
     const {bytesRead}=await file.read(block,0,block.length,chunkStart);
     if(bytesRead!==block.length)throw Error('Artifact truncated');
     if(createHash('sha256').update(block).digest('hex')!==chunkHashes[chunkIndex])throw Error('Artifact changed');
     await unchanged();
     if(finished)return;
     const selected=block.subarray(offset-chunkStart,Math.min(block.length,end-chunkStart+1));
     offset+=selected.length;
     if(offset>end){await close();if(finished)return;finished=true;controller.enqueue(selected);controller.close();}
     else controller.enqueue(selected);
    }catch(error){if(!finished){finished=true;controller.error(error);}await close();}
   },
   async cancel(){finished=true;await close();},
  },{highWaterMark:0});
 }};
 }catch(e){await close();throw e;}
}
