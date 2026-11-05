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
 async load(walletId,id){
  const file=this.location(walletId,id);let handle;
  try{handle=await this.fs.open(file,'r');}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  let sealed;
  try{const info=await handle.stat();if(!info.isFile()||info.size>MAX)throw Error('Saved signature exceeds the size limit.');const buffer=Buffer.alloc(MAX+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>MAX)throw Error('Saved signature exceeds the size limit.');sealed=buffer.subarray(0,bytesRead);}
  finally{await handle.close();}
  try{return this.validate(JSON.parse(await this.unseal(sealed)),walletId,id);}
  catch{throw Error('Saved signature cannot be decrypted or is damaged. Its files were preserved.');}
 }
 async save(walletId,request,response){
  const id=String(request?.fingerprint||'').slice(2),file=this.location(walletId,id);
  const record=this.validate({version:1,walletId,request,response},walletId,id);
  const previous=await this.load(walletId,id);if(previous){if(!isDeepStrictEqual(previous.request,request))throw Error('Saved request conflicts with this fingerprint.');return previous;}
  const text=JSON.stringify(record);if(Buffer.byteLength(text)>128*1024)throw Error('Saved signature exceeds the size limit.');
  const sealed=await this.seal(text);if(!Buffer.isBuffer(sealed)||sealed.length===0||sealed.length>MAX)throw Error('Signature encryption failed.');
  const temp=file+'.'+randomUUID()+'.tmp';await this.fs.mkdir(path.dirname(file),{recursive:true});
  try{
   const handle=await this.fs.open(temp,'wx',0o600);
   try{await handle.writeFile(sealed);await handle.sync();}finally{await handle.close();}
   // Atomic, exclusive publication in the local profile; never replace an entry.
   try{await this.fs.link(temp,file);}catch(error){if(error.code!=='EEXIST')throw error;}
   const saved=await this.load(walletId,id);if(!saved)throw Error('Signature persistence verification failed.');
   if(!isDeepStrictEqual(saved.request,request))throw Error('Saved request conflicts with this fingerprint.');
   return saved;
  }finally{await this.fs.rm(temp,{force:true}).catch(()=>{});}
 }
 async list(walletId){
  // Validate the wallet before constructing its directory.
  this.location(walletId,'0'.repeat(64));let names;
  try{names=await this.fs.readdir(path.join(this.directory,walletId));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const ids=names.filter(name=>/^[0-9a-f]{64}\.bin$/.test(name)).map(name=>name.slice(0,-4));
  if(ids.length>1000)throw Error('Too many saved signatures. Keep this profile and contact support.');
  const records=[];for(const id of ids){const record=await this.load(walletId,id);if(!record)throw Error('Saved signature changed while loading.');records.push(record);}
  return records.sort((a,b)=>String(b.response.signedAt).localeCompare(String(a.response.signedAt)));
 }
}
module.exports={SignatureStore};

