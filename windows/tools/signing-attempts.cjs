'use strict';
// Main-process only. An irreversible claim precedes every key-bearing signing
// child. A missing result never means that child created no transferable bytes.
const path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {SignatureStore}=require('../signature-store.cjs');
const uncertain='Signing outcome is uncertain. New signing for this wallet is disabled. Preserve this profile and recover the original signed response; do not retry or replace it.';
const activeWallets=new Set();
const authorities=new Set(['transaction','private-proof']);
function snapshot(value,limit=64*1024){const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>limit)throw Error('Signing request exceeds its recovery limit.');return JSON.parse(text);}
class SigningAttempts{
 constructor(directory,storage,primary){
  this.primary=primary;this.busy=activeWallets;this.lockPrefix=path.resolve(directory)+(process.platform==='win32'?'':':');
  if(process.platform==='win32')this.lockPrefix=this.lockPrefix.toLowerCase();
  this.attempts=new SignatureStore(path.join(directory,'signing-attempts-v1'),storage.forJournal('signing-attempts'));
  this.results=new SignatureStore(path.join(directory,'signing-results-v1'),storage.forJournal('signing-results'));
 }
 store(authority){if(!authorities.has(authority)||!this.primary[authority])throw Error('Unknown signing recovery authority.');return this.primary[authority];}
 marker(request,authority){this.store(authority);return {version:1,kind:'drivekey-signing-attempt',authority,deviceId:request.deviceId,requestId:request.requestId,fingerprint:request.fingerprint,outcome:'unknown'};}
 checkedMarker(record){const a=record.response;if(!isDeepStrictEqual(a,this.marker(record.request,a?.authority)))throw Error('Signing-attempt record is damaged. Preserve this profile.');return a;}
 async existing(walletId,request,authority,verify){
  const id=request.fingerprint.slice(2),a=await this.store(authority).load(walletId,id),b=await this.results.load(walletId,id);
  if(b){const marker=await this.attempts.load(walletId,id);if(!marker||this.checkedMarker(marker).authority!==authority||!isDeepStrictEqual(marker.request,request))throw Error('Signing result lacks its original attempt. Preserve this profile.');}
  for(const record of [a,b].filter(Boolean))if(!isDeepStrictEqual(record.request,request))throw Error('Original signing request differs. Preserve this profile.');
  if(a&&b&&!isDeepStrictEqual(a.response,b.response))throw Error('Original signing responses conflict. Preserve this profile.');
  const record=a||b;if(!record)return null;
  const response=await verify(structuredClone(record.response),structuredClone(record.request),authority);
  if(!isDeepStrictEqual(response,record.response))throw Error('Recovery changed the original signing response. Preserve this profile.');return {request:record.request,response};
 }
 async assertResolved(walletId,verify){
  for(const record of await this.attempts.list(walletId)){
   const marker=this.checkedMarker(record);
   if(!await this.existing(walletId,record.request,marker.authority,verify))throw Error(uncertain);
  }
 }
 async run({walletId,request:input,authority,verify,sign,current=()=>{}}){
  const lock=this.lockPrefix+walletId;if(this.busy.has(lock))throw Error('Finish the current signing operation for this wallet first.');
  this.busy.add(lock);let claimed=false;
  try{
   this.store(authority);const request=snapshot(input,authority==='private-proof'?96*1024:64*1024);if(walletId!==request.deviceId)throw Error('Signing wallet differs.');
   const unsigned=request.chainRequest?.unsignedTransaction||request.unsignedTransaction||'',responseCeiling=authority==='private-proof'?4096:Math.max(10240,Buffer.byteLength(unsigned)+2048);
   if(Buffer.byteLength(JSON.stringify(request))+responseCeiling+4096>128*1024)throw Error('This request leaves insufficient encrypted recovery capacity. No signature was created.');
   let saved=await this.existing(walletId,request,authority,verify);if(saved)return {...saved,reused:true};
   // Unresolved attempts block different requests and authority types as well.
   await this.assertResolved(walletId,verify);
   current();const claim=await this.attempts.claim(walletId,request,this.marker(request,authority));
   if(!claim.created)throw Error(uncertain);claimed=true;this.checkedMarker(claim.record);current();
   // From here no exception, timeout, cancellation or process death permits a
   // new signature. No reset/delete/retry endpoint exists for these records.
   const response=snapshot(await sign(structuredClone(request)),128*1024);
   // Preserve bytes before any new worker, UI scope check or primary journal
   // write. An interrupted publication leaves encrypted temporary recovery.
   try{await this.results.save(walletId,request,response);}catch{/* Try the independent primary journal too. */}
   const verified=await verify(structuredClone(response),structuredClone(request),authority);
   if(!isDeepStrictEqual(verified,response))throw Error('Signing verification changed the response. Preserve this profile.');
   try{await this.store(authority).save(walletId,request,response);}catch{/* The result journal may already be durable. */}
   saved=await this.existing(walletId,request,authority,verify);
   if(!saved)throw Error(uncertain);return {...saved,reused:false};
  }catch(error){if(claimed)throw Error(uncertain);throw error;}finally{this.busy.delete(lock);}
 }
 async recover(walletId,id,authority,verify){
  const primary=await this.store(authority).load(walletId,id),result=await this.results.load(walletId,id),record=primary||result;
  if(!record)return null;return this.existing(walletId,record.request,authority,verify);
 }
 async list(walletId,authority){
  const rows=new Map((await this.store(authority).list(walletId)).map(r=>[r.request.fingerprint,r]));
  const markers=await this.attempts.list(walletId),results=await this.results.list(walletId);
  for(const r of results){const marker=markers.find(m=>m.request.fingerprint===r.request.fingerprint);if(!marker)throw Error('Signing result lacks its original attempt. Preserve this profile.');const m=this.checkedMarker(marker);if(m.authority!==authority)continue;
   if(!isDeepStrictEqual(marker.request,r.request))throw Error('Signing result request differs. Preserve this profile.');
   const old=rows.get(r.request.fingerprint);if(old&&!isDeepStrictEqual(old.response,r.response))throw Error('Signing responses conflict. Preserve this profile.');rows.set(r.request.fingerprint,old||r);
  }
  for(const r of markers)if(this.checkedMarker(r).authority===authority&&!rows.has(r.request.fingerprint))rows.set(r.request.fingerprint,{request:r.request,uncertain:true});
  return [...rows.values()];
 }
}
module.exports={SigningAttempts};
