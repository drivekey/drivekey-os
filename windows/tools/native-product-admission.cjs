'use strict';
// Privileged public-proof import. Renderer receives only the new chain review.
const fs=require('node:fs/promises'),{TextDecoder}=require('node:util'),{randomUUID}=require('node:crypto');
const {parseStrictJSON}=require('./strict-json.cjs');
const {verifyProductProofPackage,verifyProductPackageChain,productBindingSchema}=require('../dist/hinkal-product-admission.cjs');
const {createProductChain,verifyProductChain}=require('../dist/hinkal-product-chain.cjs');
const {validateProductProof}=require('../dist/hinkal-product-proof.cjs');
const {canonical}=require('../dist/payment.cjs');
async function readProductProofPackage(file){
 const handle=await fs.open(file,'r');let bytes;
 try{const info=await handle.stat();if(!info.isFile()||info.size>256*1024)throw Error('Choose a proof package smaller than 256 KiB.');bytes=Buffer.alloc(256*1024+1);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>256*1024)throw Error('Proof package exceeds the size limit.');return parseStrictJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));}
 finally{bytes?.fill(0);await handle.close();}
}
function installProductAdmission(c){
 let epoch=0;const clear=()=>{epoch++;};
 const checked=async operation=>{try{return await operation();}catch{throw Error('Private proof package could not be verified. Check the wallet, original authorization, proof bytes and expiry. Preserve all files.');}};
 const scope=()=>{if(c.isOffline())throw Error('Proof admission is unavailable in the offline companion.');const at=Date.now(),started=performance.now();return {epoch,wallet:structuredClone(c.getPublic()),window:c.getWindow(),vaultHash:c.getVaultHash(),clock:()=>at+Math.floor(performance.now()-started)};};
 const current=s=>{if(s.epoch!==epoch||s.window!==c.getWindow()||!s.window||s.window.isDestroyed?.()||canonical(s.wallet)!==canonical(c.getPublic())||s.vaultHash!==c.getVaultHash())throw Error('Proof admission was canceled because the review, wallet or window changed.');};
 async function savedPackage(wallet,fingerprint){
  const id=fingerprint.slice(2),auth=await c.authorizationStore.load(wallet.deviceId,id),result=await c.resultStore.load(wallet.deviceId,id);
  if(!auth||!result||canonical(auth.request)!==canonical(result.request))throw Error('Original proof recovery is missing or differs. Preserve this profile.');
  return {version:28,kind:'drivekey-hinkal-product-proof-package',request:auth.request,response:auth.response,result:result.response};
 }
 async function verifyRecord(record,wallet,expiry=true,now=Date.now()){
  if(record.productProof===undefined)return;
  if(expiry&&record.request.version!==29)throw Error('This earlier proof-bound transaction lacks the offline product envelope. Its records are preserved for recovery; no new approval is available.');
  const binding=productBindingSchema.parse(record.productProof),p=await savedPackage(wallet,binding.requestFingerprint),envelope=record.request.version===29?await checked(()=>verifyProductChain(record.request,wallet,now,expiry)):null;
  if(envelope&&canonical(envelope.package)!==canonical(p))throw Error('Envelope differs from the immutable saved proof package.');
  const verified=await checked(()=>verifyProductPackageChain(p,wallet,envelope?envelope.chainRequest:record.request,now,expiry));
  if(canonical(verified.productProof)!==canonical(binding))throw Error('Saved chain request differs from its original product proof binding. Preserve this profile.');
  return {...verified,request:record.request};
 }
 async function verifyPending(pending,wallet,expiry=true){
  if(pending.productProof===undefined)return;
  const record=await c.transactionStore.load(wallet.deviceId,pending.request.fingerprint);
  if(!record||canonical(record.request)!==canonical(pending.request)||canonical(record.productProof)!==canonical(pending.productProof))throw Error('The pending request differs from its original proof-bound journal. Preserve this profile.');
  return verifyRecord(record,wallet,expiry);
 }
 c.register('import-product-proof-package',async()=>{
  c.clearPending();clear();const s=scope();
  const picked=await c.dialog.showOpenDialog(s.window,{title:'Prepare transaction from private proof',properties:['openFile'],filters:[{name:'DriveKey proof package',extensions:['json']}]});current(s);if(picked.canceled)return {cancelled:true};
  const document=await readProductProofPackage(picked.filePaths[0]);current(s);c.policy.assertProductProof(document?.request);
  const p=await checked(()=>verifyProductProofPackage(document,s.wallet,s.clock()));current(s);
  const records=await c.transactionStore.list(s.wallet.deviceId);current(s);
  const matches=records.filter(r=>r.productProof?.requestFingerprint===p.request.fingerprint);if(matches.length>1)throw Error('Multiple requests claim this proof package. Preserve and reconcile them before continuing.');
  let request,productProof,reused=false;
  if(matches.length){
   const record=matches[0];if(record.state!=='prepared'||record.response)throw Error('This proof already has a signed or submitted transaction. Reconcile the original request; no replacement was prepared.');
   const original=await savedPackage(s.wallet,p.request.fingerprint);current(s);if(canonical(original)!==canonical(p))throw Error('Imported proof differs from the immutable original package.');
   ({request,productProof}=await verifyRecord(record,s.wallet,true,s.clock()));current(s);reused=true;
  }else{
   const notes=new Set(p.request.seed.job.context.inputNotes),overlap=records.some(r=>{
    const inner=r.request?.version===29?r.request.chainRequest:r.request;
    const existing=inner?.proofSeed?.job?.context?.inputNotes||inner?.inputNotes||[];
    return existing.some(n=>notes.has(n));
   });
   if(overlap)throw Error('Private inputs already belong to another saved request. Reconcile or explicitly cancel that workflow before preparing another one.');
   const auth=await c.authorizationStore.save(s.wallet.deviceId,p.request,p.response);current(s);if(canonical(auth.response)!==canonical(p.response))throw Error('A different authorization already exists for this proof request.');
   const result=await c.resultStore.save(s.wallet.deviceId,p.request,p.result);current(s);if(canonical(result.response)!==canonical(p.result))throw Error('A different proof result already exists for this request.');
   const prepared=await c.online({action:'hinkal-product-proof-prepare',input:p,wallet:s.wallet});current(s);
   const verified=await checked(()=>verifyProductPackageChain(p,s.wallet,prepared.request,s.clock()));current(s);
   if(canonical(verified.productProof)!==canonical(prepared.productProof))throw Error('Online proof admission returned a different binding.');
   productProof=verified.productProof;request=await checked(()=>createProductChain(p,s.wallet,verified.request,s.clock()));current(s);c.validateIntent(request);c.assertIntentWallet(request,s.wallet);
   await c.transactionStore.put({version:1,request,productProof,state:'prepared',updatedAt:new Date().toISOString()});current(s);
  }
  validateProductProof(p.request,s.clock());current(s);const review=c.reviewIntent(request),token=randomUUID();
  c.setPending({token,request,review,productProof,vaultHash:s.vaultHash});return {token,review,reused,proofRequestFingerprint:p.request.fingerprint,requiresSeparateChainReview:true};
 });
 return {clear,verifyRecord,verifyPending};
}
module.exports={installProductAdmission,readProductProofPackage};
