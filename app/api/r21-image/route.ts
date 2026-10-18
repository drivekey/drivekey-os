import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import candidate from '../../../core/r21-ui-release.json';
import {blockedOfflineReleaseResponse,legacyResearchDownloadsEnabled} from '../../../core/offline-release-status';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const path=()=>join(process.cwd(),'outputs','images',candidate.filename);
let verified:{mtime:number;check:Promise<boolean>}|undefined;
async function available(){
 if(process.env.VERCEL)return false;
 try{
  const stat=await lstat(path());if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==candidate.bytes)return false;
  if(!verified||verified.mtime!==stat.mtimeMs){
   const check=(async()=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path()))hash.update(chunk);return hash.digest('hex')===candidate.sha256;})().catch(()=>false);
   verified={mtime:stat.mtimeMs,check};
  }
  return await verified.check;
 }catch{return false;}
}
const unavailable=()=>Response.json({error:'The legacy RC4 research artifact is unavailable. It is not an approved funded release.'},{status:503,headers:{'Cache-Control':'no-store'}});
export async function HEAD(){if(!legacyResearchDownloadsEnabled())return blockedOfflineReleaseResponse();return await available()?new Response(null,{headers:{'Content-Length':String(candidate.bytes),'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-DriveKey-Release-Class':'legacy-unfunded-research'}}):unavailable();}
export async function GET(request:Request){
 if(!legacyResearchDownloadsEnabled())return blockedOfflineReleaseResponse();
 if(!await available())return unavailable();let start=0,end=candidate.bytes-1;const range=request.headers.get('range');
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return new Response(null,{status:416});start=Number(m[1]);end=m[2]?Number(m[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=candidate.bytes)return new Response(null,{status:416});}
 return new Response(Readable.toWeb(createReadStream(path(),{start,end})) as ReadableStream,{status:range?206:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${candidate.filename}"`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-DriveKey-Release-Class':'legacy-unfunded-research',...(range?{'Content-Range':`bytes ${start}-${end}/${candidate.bytes}`}:{})}});
}
