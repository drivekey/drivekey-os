'use strict';
// Immutable PUBLIC encrypted-history pages. No wallet identity or decoded notes.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{validatePublicNoteSnapshot,validatePublicNotePage}=require('../dist/hinkal-note-snapshot.cjs');
class PublicNotePages{
 constructor(directory){this.directory=path.resolve(directory);}
 location(input,index){const m=validatePublicNoteSnapshot(input);if(!Number.isSafeInteger(index)||index<0||index>=m.pageHashes.length)throw Error('Invalid public history page index.');return path.join(this.directory,m.fingerprint,String(index).padStart(4,'0')+'.json');}
 async directoryCheck(directory){const s=await fs.lstat(directory).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(s&&(!s.isDirectory()||s.isSymbolicLink()))throw Error('Redirected public history cache.');}
 async get(manifest,index){
  const file=this.location(manifest,index),scope=path.dirname(file);await this.directoryCheck(this.directory);await this.directoryCheck(scope);const names=await fs.readdir(scope).catch(e=>{if(e.code==='ENOENT')return [];throw e;}),prefix=String(index).padStart(4,'0'),pattern=new RegExp('^'+prefix+'(?:\\.[0-9a-f-]{36})?\\.json$'),selected=names.filter(n=>pattern.test(n)).sort();if(selected.length>8)throw Error('Too many preserved public page copies. Preserve this cache.');
  for(const name of selected){const location=path.join(scope,name),s=await fs.lstat(location);if(!s.isFile()||s.isSymbolicLink())throw Error('Redirected public history page.');const handle=await fs.open(location,'r');let bytes;try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>256*1024)throw Error('Damaged public page size.');bytes=Buffer.alloc(stat.size+1);const r=await handle.read(bytes,0,bytes.length,0);if(r.bytesRead!==stat.size)throw Error('Public history page changed while reading.');const page=require('./strict-json.cjs').parseStrictJSON(new(require('node:util').TextDecoder)('utf-8',{fatal:true}).decode(bytes.subarray(0,r.bytesRead)));return validatePublicNotePage(manifest,page).page;}catch{/* Public corruption never authorizes replacing private or signed records. */}finally{bytes?.fill(0);await handle.close();}}
  if(selected.length){const e=Error('Public history copies are damaged. Import the original public history file; every old copy is preserved.');e.publicHistoryDamage=true;throw e;}return null;
 }
 async put(manifest,input){
  const page=validatePublicNotePage(manifest,input).page,base=this.location(manifest,page.index),text=JSON.stringify(page)+'\n';if(Buffer.byteLength(text)>256*1024)throw Error('Public page cache limit exceeded.');let damaged=false;try{const existing=await this.get(manifest,page.index);if(existing)return existing;}catch(e){if(!e.publicHistoryDamage)throw e;damaged=true;}
  await fs.mkdir(this.directory,{recursive:true});await this.directoryCheck(this.directory);await fs.mkdir(path.dirname(base),{recursive:true});await this.directoryCheck(path.dirname(base));const file=damaged?base.replace(/\.json$/,'.'+randomUUID()+'.json'):base;let handle;try{handle=await fs.open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')return this.get(manifest,page.index);throw e;}try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}return this.get(manifest,page.index);
 }
}
module.exports={PublicNotePages};
