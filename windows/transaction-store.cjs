// One writer is enforced by Electron's profile lock. Transferable bytes are DPAPI encrypted.
const {validateHandoff,assertHandoffTransition,discardableShape}=require('./tools/request-lifecycle.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const MAX_PLAIN=128*1024,MAX_SEALED=256*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,HASH=/^0x[0-9a-f]{64}$/;
const SETTLEMENT_STATES=['confirmed','failed','pending','uncertain','conflict','expired-unresolved','destination-pending'];
const STATES=['prepared','discarded','signed','submitting',...SETTLEMENT_STATES];
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
function snapshot(record){
 const text=JSON.stringify(record);
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_PLAIN)throw Error('Invalid journal size.');
 return JSON.parse(text);
}
function validateRecord(r,wallet,id){
 if(!r||r.version!==1||!UUID.test(wallet)||!HASH.test(id)||r.request?.deviceId!==wallet||r.request?.fingerprint!==id||!UUID.test(r.request?.requestId)||!STATES.includes(r.state))throw Error('Transaction journal identity or state mismatch.');
 const s=r.response;
 if(s&&(s.version!==r.request.version||s.deviceId!==wallet||s.requestId!==r.request.requestId||s.fingerprint!==id||typeof s.transactionHash!=='string'||!s.transactionHash||typeof s.rawSignedTransaction!=='string'||!s.rawSignedTransaction))throw Error('Transaction response identity mismatch.');
 if(r.handoff!==undefined)validateHandoff(r.handoff);
 if(r.state==='discarded'&&(s||!discardableShape({...r,state:'prepared'})||typeof r.discardedAt!=='string'||!Number.isSafeInteger(Date.parse(r.discardedAt))))throw Error('Invalid discarded-draft evidence.');
 if(!['prepared','discarded'].includes(r.state)&&!s)throw Error('Signed transaction response is required.');
 return r;
}
function reconcileRecord(record,input,{destination=false}={}){
 // Worker output is evidence, never authority to replace the signed journal.
 const result=snapshot(input);
 if(!result||Array.isArray(result)||!SETTLEMENT_STATES.includes(result.state)||['version','request','response','updatedAt','submissionAttempted'].some(k=>Object.hasOwn(result,k)))throw Error('Invalid reconciliation response.');
 if(result.reason!==undefined&&(typeof result.reason!=='string'||result.reason.length>2000))throw Error('Invalid reconciliation reason.');
 if((destination||[25,26].includes(record.request.version))&&result.state==='confirmed'&&result.completeRoute!==true)throw Error('Complete route settlement is required.');
 return {...record,state:result.state,...(result.reason===undefined?{reason:undefined}:{reason:result.reason}),[destination?'destinationSettlement':'settlement']:result,updatedAt:new Date().toISOString()};
}
class TransactionStore{
 constructor(directory,{seal,unseal,beforeDiscard}){this.directory=directory;this.seal=seal;this.unseal=unseal;this.beforeDiscard=beforeDiscard;}
 file(wallet,id){if(!UUID.test(wallet)||!HASH.test(id))throw Error('Invalid transaction scope.');return path.join(this.directory,wallet,id.slice(2)+'.bin');}
 async load(wallet,id){
  const file=this.file(wallet,id);let handle;
  try{handle=await fs.open(file,'r');}catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{
   const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_SEALED)throw Error('Transaction journal too large.');
   const buffer=Buffer.alloc(MAX_SEALED+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
   if(bytesRead>MAX_SEALED)throw Error('Transaction journal too large.');
   const text=await this.unseal(buffer.subarray(0,bytesRead));
   if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_PLAIN)throw Error('Invalid journal size.');
   return validateRecord(JSON.parse(text),wallet,id);
  }finally{await handle.close();}
 }
 async put(input){
  // Snapshot before any await: callers cannot mutate a record while it is saved.
  const record=snapshot(input),wallet=record.request?.deviceId,id=record.request?.fingerprint,file=this.file(wallet,id);
  validateRecord(record,wallet,id);
  const old=await this.load(wallet,id);
  if(old){
   assertHandoffTransition(old.handoff,record.handoff);
   if(old.state==='discarded'){if(canonical(old)!==canonical(record))throw Error('A discarded request is immutable and cannot be activated again.');return old;}
   if(canonical(old.productProof)!==canonical(record.productProof))throw Error('The original product proof binding is immutable.');
   if(canonical(old.request)!==canonical(record.request)||old.response&&canonical(old.response)!==canonical(record.response))throw Error('Approved transaction is immutable.');
   if(old.state!=='prepared'&&record.state==='prepared'||!['prepared','signed'].includes(old.state)&&['prepared','signed'].includes(record.state)||old.state!=='signed'&&old.state!=='submitting'&&record.state==='submitting')throw Error('Transaction submission state cannot be reset.');
  }
  if(record.state==='discarded'){if(!old||old.state!=='prepared'||old.response||!discardableShape(old)||typeof this.beforeDiscard!=='function')throw Error('The original unsigned-draft guard is required.');await this.beforeDiscard(old);}
  await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';
  try{
   const sealed=await this.seal(JSON.stringify(record));if(!Buffer.isBuffer(sealed)||sealed.length===0||sealed.length>MAX_SEALED)throw Error('Invalid encrypted journal.');
   const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(sealed);await h.sync();}finally{await h.close();}
   await fs.rename(tmp,file);
  }finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  return record;
 }
 async list(wallet){
  this.file(wallet,'0x'+'0'.repeat(64));let files;try{files=await fs.readdir(path.join(this.directory,wallet));}catch(e){if(e.code==='ENOENT')return [];throw e;}
  if(files.length>2000)throw Error('Transaction journal limit exceeded.');const ids=files.filter(f=>/^[0-9a-f]{64}\.bin$/i.test(f)).map(f=>'0x'+f.slice(0,-4).toLowerCase());
  if(new Set(ids).size!==ids.length)throw Error('Ambiguous transaction journal filenames. Preserve this profile.');
  const records=[];for(const id of ids){const record=await this.load(wallet,id);if(!record)throw Error('Transaction journal changed while loading.');records.push(record);}return records;
 }
}
module.exports={TransactionStore,reconcileRecord};
