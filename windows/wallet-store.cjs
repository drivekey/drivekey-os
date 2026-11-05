// Local, public wallet catalog. Encrypted vaults stay in the files chosen by the user.
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const MAX_BYTES=1024*1024;
class CatalogError extends Error{
 constructor(message,canRecover=false){super(message);this.name='CatalogError';this.canRecover=canRecover;}
}
function cleanName(value){
 if(typeof value!=='string')throw Error('Enter a wallet name.');
 const name=value.trim();
 if(!name||[...name].length>40||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name))throw Error('Use 1–40 visible characters for the wallet name.');
 return name;
}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
const vaultDigest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function publicIdentity(value){
 if(!value||value.version!==3||typeof value.deviceId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.deviceId)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||typeof value.evmAddress!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value.evmAddress)||typeof value.solanaAddress!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.solanaAddress))throw Error('Invalid public wallet identity.');
 return {version:3,deviceId:value.deviceId,createdAt:value.createdAt,evmAddress:value.evmAddress,solanaAddress:value.solanaAddress};
}
const sameIdentity=(a,b)=>a.deviceId===b.deviceId&&a.createdAt===b.createdAt&&a.evmAddress===b.evmAddress&&a.solanaAddress===b.solanaAddress;
class WalletStore{
 constructor(file,options={}){this.file=path.resolve(file);this.fs=options.fs||fs;this.records=[];this.loading=null;this.problem=null;}
 async init(){
  if(!this.loading)this.loading=this.load();
  const pending=this.loading;
  try{await pending;return this;}catch(error){if(this.loading===pending)this.loading=null;throw error;}
 }
 async readBytes(){
  try{const handle=await this.fs.open(this.file,'r');try{const info=await handle.stat();if(!info.isFile()||info.size>MAX_BYTES)throw new CatalogError('The saved wallet list is too large or is not a file. Your vault files are unchanged.');const buffer=Buffer.alloc(MAX_BYTES+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>MAX_BYTES)throw new CatalogError('The saved wallet list is too large. Your vault files are unchanged.');return buffer.subarray(0,bytesRead);}finally{await handle.close();}}
  catch(error){if(error.code==='ENOENT')return null;if(error instanceof CatalogError)throw error;throw new CatalogError('The saved wallet list could not be read. Check access and try again. Your vault files are unchanged.');}
 }
 parse(bytes){
  try{
   const data=JSON.parse(bytes.toString('utf8'));
   if(data?.version!==1||!Array.isArray(data.wallets))throw Error('Invalid catalog.');
   const ids=new Set(),identities=new Set();
   const records=data.wallets.map(entry=>{
    if(!entry||typeof entry.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id)||ids.has(entry.id)||typeof entry.file!=='string'||!path.isAbsolute(entry.file)||entry.file.length>32767||entry.file.includes('\0')||typeof entry.vaultHash!=='string'||! /^[0-9a-f]{64}$/.test(entry.vaultHash))throw Error('Invalid catalog entry.');
    const identity=publicIdentity(entry.public);if(identities.has(identity.deviceId))throw Error('Duplicate wallet identity.');ids.add(entry.id);identities.add(identity.deviceId);
    return {id:entry.id,name:cleanName(entry.name),file:entry.file,public:identity,vaultHash:entry.vaultHash};
   });
   return records;
  }catch{throw new CatalogError('The saved wallet list is damaged. Your vault files are unchanged.',true);}
 }
 async load(){
  try{const bytes=await this.readBytes(),records=bytes===null?[]:this.parse(bytes);this.records=records;this.problem=null;}
  catch(error){this.problem={error:error.message,canRecover:error instanceof CatalogError&&error.canRecover};throw error;}
 }
 async retry(){this.loading=null;return this.init();}
 async recover(){
  // Re-read after the confirmation so a repaired healthy catalog is never reset.
  const original=await this.readBytes();
  if(original===null){await this.retry();return {recovered:false};}
  try{const records=this.parse(original);this.records=records;this.problem=null;this.loading=Promise.resolve();return {recovered:false};}
  catch(error){if(!(error instanceof CatalogError)||!error.canRecover)throw error;}
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),quarantine=this.file+'.damaged-'+stamp+'-'+randomUUID()+'.json';
  try{
   const handle=await this.fs.open(quarantine,'wx',0o600);
   try{await handle.writeFile(original);await handle.sync();}finally{await handle.close();}
   const preserved=await this.fs.readFile(quarantine);
   if(!preserved.equals(original))throw Error('Catalog backup verification failed.');
  }catch{throw Error('Could not preserve the damaged wallet list. No wallet list was reset.');}
  const latest=await this.readBytes();
  if(latest===null||!latest.equals(original))throw Error('The saved wallet list changed during recovery. Try again; no wallet list was reset.');
  await this.persist([]);
  this.problem=null;this.loading=Promise.resolve();return {recovered:true};
 }
 async persist(records){
  const serialized=JSON.stringify({version:1,wallets:records},null,2)+'\n';
  if(Buffer.byteLength(serialized)>MAX_BYTES)throw Error('The local wallet list is too large. Remove unused entries before adding another.');
  const directory=path.dirname(this.file),temporary=this.file+'.'+randomUUID()+'.tmp';
  try{
   await this.fs.mkdir(directory,{recursive:true});
   const handle=await this.fs.open(temporary,'wx',0o600);
   try{await handle.writeFile(serialized,'utf8');await handle.sync();}finally{await handle.close();}
   await this.fs.rename(temporary,this.file);
  }catch{await this.fs.rm(temporary,{force:true}).catch(()=>{});throw Error('Could not save the local wallet list. The current wallet was not changed.');}
  this.records=records;
 }
 get(id){const record=this.records.find(item=>item.id===id);if(!record)throw Error('Choose a wallet from your list.');return record;}
 list(activeId=null,verified=new Map()){
  return {wallets:this.records.map(record=>({id:record.id,name:record.name,deviceId:record.public.deviceId,evmAddress:record.public.evmAddress,solanaAddress:record.public.solanaAddress,active:record.id===activeId,backupVerified:verified.get(record.id)===record.vaultHash})),activeId};
 }
 assertVault(record,vault,identity){
  if(vaultDigest(vault)!==record.vaultHash||!sameIdentity(record.public,publicIdentity(identity)))throw Error('This wallet file changed or belongs to another identity. Open the original encrypted vault.');
 }
 async upsert(file,vault,identity,name){
  await this.init();const cleanPublic=publicIdentity(identity),hash=vaultDigest(vault);
  let canonicalFile;try{canonicalFile=await this.fs.realpath(file);}catch{throw Error('The selected wallet file is missing or unreadable.');}
  const existing=this.records.find(item=>item.public.deviceId===cleanPublic.deviceId);
  if(existing){
   this.assertVault(existing,vault,cleanPublic);
   if(existing.file!==canonicalFile){const next={...existing,file:canonicalFile};await this.persist(this.records.map(item=>item.id===existing.id?next:item));return next;}
   return existing;
  }
  if(this.records.some(item=>item.file.toLowerCase()===canonicalFile.toLowerCase()))throw Error('This file is already linked to a different wallet.');
  const record={id:randomUUID(),name:cleanName(name===undefined?'Wallet '+(this.records.length+1):name),file:canonicalFile,public:cleanPublic,vaultHash:hash};
  await this.persist([...this.records,record]);return record;
 }
 async rename(id,name){await this.init();this.get(id);const clean=cleanName(name);await this.persist(this.records.map(item=>item.id===id?{...item,name:clean}:item));}
 async remove(id){await this.init();this.get(id);await this.persist(this.records.filter(item=>item.id!==id));}
}
module.exports={WalletStore,cleanName,vaultDigest};
