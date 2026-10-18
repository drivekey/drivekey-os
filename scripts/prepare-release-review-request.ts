// Public review material only. Generates no keys, signatures, installation or funding authority.
import {createHash} from 'node:crypto';
import {constants,createReadStream} from 'node:fs';
import {lstat,realpath,open,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {releaseManifestSchema,releaseSigningBytes} from '../core/release-auth';
import {parseStrictPublicJson} from '../core/strict-public-json';

const asset=z.object({name:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/),path:z.string().min(1),bytes:z.number().int().positive().max(8*1024**3),sha256:z.string().regex(/^[a-f0-9]{64}$/),role:z.enum(['payload','source','evidence'])}).strict();
const configSchema=z.object({manifest:releaseManifestSchema,assets:z.array(asset).min(3).max(32),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceClosure:z.enum(['partial','complete-unreviewed'])}).strict();
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function checkedAsset(entry:z.infer<typeof asset>){
 const full=resolve(entry.path);if(await realpath(full)!==full)throw Error('Linked asset refused');
 const before=await lstat(full);if(!before.isFile()||before.isSymbolicLink()||before.size!==entry.bytes)throw Error('Asset size/type differs');
 const h=await open(full,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 const same=(s:typeof before)=>s.isFile()&&s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.mtimeMs===before.mtimeMs&&s.ctimeMs===before.ctimeMs;
 try{
  if(!same(await h.stat()))throw Error('Asset changed on open');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream('',{fd:h.fd,autoClose:false})){bytes+=chunk.length;if(bytes>entry.bytes)throw Error('Asset grew');hash.update(chunk);}
  if(bytes!==entry.bytes||hash.digest('hex')!==entry.sha256||!same(await h.stat()))throw Error('Asset hash or identity differs');
 }finally{await h.close();}
 return {name:entry.name,role:entry.role,bytes:entry.bytes,sha256:entry.sha256};
}
export async function prepareReleaseReview(input:unknown,output:string){
 const config=configSchema.parse(input),m=config.manifest;
 if(m.channel!=='candidate')throw Error('Only an unsigned candidate proposal is supported');
 if(Date.parse(m.expiresAt)<=Date.parse(m.createdAt)||Date.parse(m.expiresAt)-Date.parse(m.createdAt)>90*86400000)throw Error('Invalid proposal lifetime');
 if(new Set(config.assets.map(a=>a.name.toLowerCase())).size!==config.assets.length)throw Error('Duplicate artifact names');
 if(new Set(config.assets.map(a=>resolve(a.path))).size!==config.assets.length)throw Error('Duplicate artifact paths');
 const payload=config.assets.filter(a=>a.role==='payload'),source=config.assets.filter(a=>a.role==='source');
 if(payload.length!==1||source.length!==1)throw Error('Exactly one payload and source bundle required');
 if(payload[0].sha256!==m.payloadSha256||payload[0].bytes!==m.payloadBytes||source[0].sha256!==m.sourceSha256)throw Error('Manifest does not bind supplied artifacts');
 const assets=[];for(const entry of config.assets)assets.push(await checkedAsset(entry));
 const bytes=releaseSigningBytes(m);
 const index={kind:'unsigned-candidate-review-request',version:1,sourceCommit:config.sourceCommit,sourceClosure:config.sourceClosure,manifest:m,assets,signingBytesSha256:digest(bytes),signatureFormat:'Existing core/release-auth.ts releaseSigningBytes; not a new format',authenticatedRelease:false,installationAuthorized:false,fundingReady:false,independentReviewCompleted:false,approvalRequestReady:false,requiredExternalEvidence:['Independent source/build/security review','Independently established custodian public roots and their control','Two approvals under the existing three-root candidate verifier','Trusted clock, boot identity and protected rollback state','Physical and route-specific funded acceptance'],scope:'A proposal and byte-identity index only. Complete-unreviewed source is not independently accepted. Asset/evidence entries are not additional signed fields in the existing manifest format.'};
 await mkdir(resolve(output)); // Refuse overwriting an earlier packet.
 await writeFile(join(output,'manifest-proposal.json'),JSON.stringify(m,null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'signing-bytes.bin'),bytes,{flag:'wx'});
 await writeFile(join(output,'review-index.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
 return index;
}
async function main(){
 if(process.argv.length!==4)throw Error('Usage: prepare-release-review-request CONFIG.json NEW_OUTPUT_DIRECTORY');
 const full=resolve(process.argv[2]),s=await lstat(full);if(!s.isFile()||s.isSymbolicLink()||s.size>65536||await realpath(full)!==full)throw Error('Invalid bounded public config');
 const h=await open(full,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 let config:unknown;try{const start=await h.stat();if(!start.isFile()||start.ino!==s.ino||start.dev!==s.dev||start.size!==s.size||start.mtimeMs!==s.mtimeMs||start.ctimeMs!==s.ctimeMs)throw Error('Config changed on open');const bytes=Buffer.alloc(65537);let total=0;while(total<bytes.length){const r=await h.read(bytes,total,bytes.length-total,total);if(!r.bytesRead)break;total+=r.bytesRead;}const end=await h.stat();if(total!==start.size||total>65536||end.size!==start.size||end.mtimeMs!==start.mtimeMs||end.ctimeMs!==start.ctimeMs)throw Error('Config changed');config=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total)),65536);}finally{await h.close();}
 const result=await prepareReleaseReview(config,process.argv[3]);console.log(JSON.stringify({output:resolve(process.argv[3]),assets:result.assets.length,authenticatedRelease:false,fundingReady:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e instanceof Error?e.message:'Review preparation failed');process.exitCode=1;});
