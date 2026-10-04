// Read-only inventory behind the same offline guard as signing.
import {lstat,statfs,readFile} from "node:fs/promises";
import {release,arch} from "node:os";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {assertOfflineEnvironment} from "./environment";
import {safeDirectory,readJsonFile} from "../core/files";
import {FILES} from "../core/protocol";
import {MULTI_FILES} from "./multi-service";
import {validateVault} from "./vault";
import {multiVaultSchema} from "./multi-vault";
import {inspectRequest} from "./inspection";

export async function offlineDashboard(directory:string) {
 await assertOfflineEnvironment();
 await safeDirectory(directory);
 async function file(name:string) {
  try {const s=await lstat(join(directory,name));return s.isFile()&&!s.isSymbolicLink()&&s.size<=32768?"present":"invalid";}
  catch(e){return (e as NodeJS.ErrnoException).code==="ENOENT"?"missing":"unreadable";}
 }
 async function vault(name:string,multi:boolean) {
  const state=await file(name);
  if(state!=="present")return {state,wallet:null};
  try {const raw=await readJsonFile(directory,name);const wallet=multi?multiVaultSchema.parse(raw).public:validateVault(raw).public;return {state:"locked",wallet};}
  catch {return {state:"invalid",wallet:null};}
 }
 const [eth,multi,ethRequest,multiRequest,ethResponse,multiResponse]=await Promise.all([
  vault(FILES.vault,false),vault(MULTI_FILES.vault,true),file(FILES.request),file(MULTI_FILES.request),file(FILES.response),file(MULTI_FILES.response)
 ]);
 const names=[...new Set([...Object.values(FILES),...Object.values(MULTI_FILES),"vault-backup.json","unsigned-trade-request.json","signed-trade-response.json","rules-account-context.json","rules-local-draft.json","rules-signed-authorization.json","rules-application-evidence.json","rules-payment-approval.json","rules-signed-payment-approval.json"])].filter(name=>/^[a-z0-9-]+\.json$/.test(name));
 const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await file(name)])));
 let build='Unavailable';
 try {const s=await lstat('/opt/drivekey/release-name.txt');if(s.isFile()&&!s.isSymbolicLink()&&s.size<160){const value=(await readFile('/opt/drivekey/release-name.txt','utf8')).trim();if(/^drivekey-offline-amd64-v[0-9]+(?:-[a-z0-9]+)*\.iso$/.test(value))build=value;}} catch {}
 let storage:null|{source:string;filesystem:string;totalBytes:number;availableBytes:number}=null;
 try{
  const stats=await statfs(directory);
  const mount=JSON.parse(execFileSync("/usr/bin/findmnt",["--json","--target",directory,"--output","SOURCE,FSTYPE"],{encoding:"utf8",timeout:3000,maxBuffer:8192})).filesystems?.[0];
  if(mount&&typeof mount.source==="string"&&typeof mount.fstype==="string")storage={source:mount.source.slice(0,120),filesystem:mount.fstype.slice(0,24),totalBytes:stats.blocks*stats.bsize,availableBytes:stats.bavail*stats.bsize};
 }catch{/* Unknown is shown as unavailable, never invented. */}
 await assertOfflineEnvironment();
 const inspections={eth:await inspectRequest(directory,false),multi:await inspectRequest(directory,true)};
 return {dashboard:{eth,multi,files,inspections,system:{build,kernel:release(),architecture:arch(),isolation:'Offline environment guard passed at inventory time; not a security attestation.'},requests:{eth:ethRequest,multi:multiRequest},responses:{eth:ethResponse,multi:multiResponse},storage,utc:new Date().toISOString(),balance:"Balance unavailable offline."},message:"Inventory refreshed. Vault passphrases have not been verified."};
}
