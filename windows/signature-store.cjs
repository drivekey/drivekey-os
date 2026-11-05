// Main process only. Transferable signatures stay encrypted in the Windows profile.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const MAX=256*1024,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,ID=/^[0-9a-f]{64}$/;
class SignatureStore{
 constructor(directory,{seal,unseal,io=fs}){this.directory=path.resolve(directory);this.seal=seal;this.unseal=unseal;this.fs=io;}
 location(walletId,id){if(!UUID.test(walletId)||!ID.test(id))throw Error('Invalid saved signature identity.');return path.join(this.directory,walletId,id+'.bin');}
 validate(record,walletId,id){
  if(record?.version!==1||record.walletId!==walletId||record.request?.deviceId!==walletId||record.response?.deviceId!==walletId||record.request?.fingerprint!=='0x'+id||record.response?.fingerprint!==record.request.fingerprint||record.response?.requestId!==record.request?.requestId)throw Error('Saved signature identity mismatch.');
  return record;
 }
 async candidates(walletId,id){
  const file=this.location(walletId,id),directory=path.dirname(file);let names;
  try{names=await this.fs.readdir(directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  if(names.length>4000)throw Error('Saved signature directory exceeds its recovery limit.');
  const pattern=new RegExp('^'+id+'\\.bin(?:\\.[0-9a-f-]{36}\\.tmp)?$','i');
  const selected=names.filter(name=>pattern.test(name));
  if(selected.filter(name=>/\.bin$/i.test(name)).length>1)throw Error('Ambiguous saved signature filenames. Preserve this profile.');
  return selected.sort().map(name=>path.join(directory,name));
 }
 async load(walletId,id){
  let result;
  for(const file of await this.candidates(walletId,id)){
   const handle=await this.fs.open(file,'r');let sealed;
   try{const info=await handle.stat();if(!info.isFile()||info.size>MAX)throw Error('Saved signature exceeds the size limit.');const buffer=Buffer.alloc(MAX+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead!==info.size||bytesRead>MAX)throw Error('Saved signature changed while reading.');sealed=buffer.subarray(0,bytesRead);}
   finally{await handle.close();}
   let record;try{const text=await this.unseal(sealed);if(typeof text!=='string'||Buffer.byteLength(text)>128*1024)throw Error();record=this.validate(JSON.parse(text),walletId,id);}
   catch{throw Error('Saved signature cannot be decrypted or is damaged. Its files were preserved.');}
   if(result&&!isDeepStrictEqual(result,record))throw Error('Conflicting interrupted signature records. Preserve this profile.');result=record;
  }
  return result||null;
 }
 async claim(walletId,request,response){return this.publish(walletId,request,response);}
 async save(walletId,request,response){return (await this.publish(walletId,request,response)).record;}
 async publish(walletId,request,response){
  const id=String(request?.fingerprint||'').slice(2),file=this.location(walletId,id);
  const snapshot=JSON.stringify({version:1,walletId,request,response});if(Buffer.byteLength(snapshot)>128*1024)throw Error('Saved signature exceeds the size limit.');
  const record=this.validate(JSON.parse(snapshot),walletId,id);request=record.request;response=record.response;
  const previous=await this.load(walletId,id);if(previous){if(!isDeepStrictEqual(previous.request,request))throw Error('Saved request conflicts with this fingerprint.');return {created:false,record:previous};}
  const text=JSON.stringify(record);if(Buffer.byteLength(text)>128*1024)throw Error('Saved signature exceeds the size limit.');
  const sealed=await this.seal(text);if(!Buffer.isBuffer(sealed)||sealed.length===0||sealed.length>MAX)throw Error('Signature encryption failed.');
  const temp=file+'.'+randomUUID()+'.tmp';let published=false,created=false;await this.fs.mkdir(path.dirname(file),{recursive:true});
  try{
   const handle=await this.fs.open(temp,'wx',0o600);
   try{await handle.writeFile(sealed);await handle.sync();}finally{await handle.close();}
   // Atomic, exclusive publication in the local profile; never replace an entry.
   try{await this.fs.link(temp,file);created=true;}catch(error){if(error.code!=='EEXIST')throw error;}
   const saved=await this.load(walletId,id);if(!saved)throw Error('Signature persistence verification failed.');
   if(!isDeepStrictEqual(saved.request,request))throw Error('Saved request conflicts with this fingerprint.');
   published=true;return {created,record:saved};
  }finally{if(published)await this.fs.rm(temp,{force:true}).catch(()=>{});}
 }
 async list(walletId){
  // Validate the wallet before constructing its directory.
  this.location(walletId,'0'.repeat(64));let names;
  try{names=await this.fs.readdir(path.join(this.directory,walletId));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const files=names.filter(name=>/^[0-9a-f]{64}\.bin(?:\.[0-9a-f-]{36}\.tmp)?$/i.test(name)),finals=files.filter(name=>/\.bin$/i.test(name)).map(name=>name.slice(0,64).toLowerCase());
  if(new Set(finals).size!==finals.length)throw Error('Ambiguous saved signature filenames. Preserve this profile.');
  const ids=[...new Set(files.map(name=>name.slice(0,64).toLowerCase()))];
  if(new Set(ids).size!==ids.length)throw Error('Ambiguous saved signature filenames. Preserve this profile.');
  if(ids.length>1000)throw Error('Too many saved signatures. Keep this profile and contact support.');
  const records=[];for(const id of ids){const record=await this.load(walletId,id);if(!record)throw Error('Saved signature changed while loading.');records.push(record);}
  return records.sort((a,b)=>String(b.response.signedAt).localeCompare(String(a.response.signedAt)));
 }
}
module.exports={SignatureStore};

