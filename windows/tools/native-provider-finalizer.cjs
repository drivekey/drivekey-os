'use strict';
const {isDeepStrictEqual}=require('node:util');
const {validateProductProof,verifyProductProofResponse,productProofReview}=require('../dist/hinkal-product-proof.cjs');
const {assertProductPackageWallet}=require('../dist/hinkal-product-admission.cjs');
const {providerProductFinalizingSupported}=require('../dist/hinkal-provider-proof.cjs');
function installProviderFinalizer(c){
 let epoch=0;const busy=new Set(),clear=()=>{epoch++;},scope=()=>({epoch,window:c.getWindow(),wallet:structuredClone(c.getPublic()),vaultHash:c.getVaultHash()});
 const current=s=>{if(s.epoch!==epoch||s.window!==c.getWindow()||!s.window||s.window.isDestroyed?.()||s.vaultHash!==c.getVaultHash()||!isDeepStrictEqual(s.wallet,c.getPublic()))throw Error('Provider proof operation canceled because the wallet, review or window changed.');};
 const idOf=value=>{const id=String(value||'').replace(/^0x/,'');if(!/^[a-f0-9]{64}$/.test(id))throw Error('Choose the original proof request.');return id;};
 async function original(s,id,expiry=false){const record=await c.requestStore.load(s.wallet.deviceId,'0x'+id);current(s);if(!record)throw Error('Original product proof request is unavailable.');const request=validateProductProof(record.request,Date.now(),expiry);assertProductPackageWallet(request,s.wallet);if(!providerProductFinalizingSupported(request))throw Error('This request uses its separate local prover.');return request;}
 c.register('import-provider-proof-authorization',async()=>{
  if(c.isOffline())throw Error('Import an already-authorized proof on the online computer.');c.clearPending();clear();const s=scope();c.policy.assertProductProof();const picked=await c.openJSON('Import original offline proof authorization');current(s);if(!picked)return {cancelled:true};const request=await original(s,idOf(picked.data?.fingerprint)),response=await verifyProductProofResponse(request,picked.data,Date.now(),false);current(s);
  const old=await c.authorizationStore.load(s.wallet.deviceId,request.fingerprint.slice(2));current(s);if(old){if(!isDeepStrictEqual(old.request,request)||!isDeepStrictEqual(old.response,response))throw Error('Original proof authorization bytes differ. Preserve both records.');return {imported:true,reused:true,fingerprint:request.fingerprint};}
  // An otherwise valid signature must not resolve a local unknown signing
  // attempt without its retained original-response witness.
  await c.signingAttempts.assertUnstarted(s.wallet.deviceId,request.fingerprint.slice(2));current(s);await c.ready();current(s);await c.authorizationStore.save(s.wallet.deviceId,request,response);current(s);return {imported:true,reused:false,fingerprint:request.fingerprint};
 });
 c.register('finalize-provider-proof',async p=>{
  if(c.isOffline())throw Error('The offline Companion cannot contact a proof provider.');c.clearPending();clear();const s=scope(),id=idOf(p?.id),lock=s.wallet.deviceId+id;if(busy.has(lock))throw Error('This proof is already being finalized.');busy.add(lock);
  try{const request=await original(s,id),authorization=await c.authorizationStore.load(s.wallet.deviceId,id);current(s);if(!authorization||!isDeepStrictEqual(authorization.request,request))throw Error('Import the original offline proof authorization first.');const response=await verifyProductProofResponse(request,authorization.response,Date.now(),false);current(s);c.policy.assertProductProof(request);
   const previous=await c.finalizations.existing(s.wallet.deviceId,request,response);current(s);if(previous)return {proved:true,reused:true,fingerprint:request.fingerprint,requiresSeparateChainReview:true};validateProductProof(request);
   await c.signingAttempts.assertResolved(s.wallet.deviceId,(signed,original,authority)=>c.verifySigningResponse(signed,original,authority,s.wallet));current(s);
   const approval=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Finalize this authorized private proof?',message:'Send only the existing circuit authorization to Hinkal?',detail:Object.entries(productProofReview(request)).map(([k,v])=>k+': '+v).join('\n')+'\n\nThe network process has no vault, password, viewing key or spending key. The provider signature, proof, exact outputs and original authorization will be verified locally. A chain transaction still requires a separate review and signature.',buttons:['Cancel','Finalize exact authorized proof'],defaultId:0,cancelId:0,noLink:true});current(s);if(approval.response!==1)return {cancelled:true};validateProductProof(request);await c.ready();current(s);
   await c.finalizations.claim(s.wallet.deviceId,request,response);current(s);
   const result=await c.job({action:'finalize-product-proof',input:{request,response},wallet:s.wallet},'provider-proof-worker.cjs',{owner:s.window});
   // Preserve independently verified completed bytes before any UI scope check.
   await c.finalizations.retain(s.wallet.deviceId,request,response,result);current(s);return {proved:true,reused:false,fingerprint:request.fingerprint,requiresSeparateChainReview:true};
  }finally{busy.delete(lock);}
 });
 c.register('export-provider-proof-result',async p=>{
  c.clearPending();clear();const s=scope(),id=idOf(p?.id),request=await original(s,id),authorization=await c.authorizationStore.load(s.wallet.deviceId,id);current(s);if(!authorization||!isDeepStrictEqual(authorization.request,request))throw Error('Original proof authorization is unavailable.');const response=await verifyProductProofResponse(request,authorization.response,Date.now(),false);current(s);c.policy.assertProductProof(request);const saved=await c.finalizations.existing(s.wallet.deviceId,request,response);current(s);if(!saved)throw Error('Original finalized proof is unavailable. Preserve this profile.');const file=await c.saveJSON('Export original authenticated provider proof','drivekey-private-proof.json',{version:28,kind:'drivekey-hinkal-product-proof-package',request,response,result:saved.response});current(s);return {saved:!!file,fingerprint:request.fingerprint,requiresSeparateChainReview:true};
 });
 return {clear};
}
module.exports={installProviderFinalizer};
