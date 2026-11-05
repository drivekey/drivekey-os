'use strict';
// Privileged desktop orchestration. No vault, proof signature or private note is
// returned to the renderer. Every export uses the real native file handoff.
const {randomUUID,createHash}=require('node:crypto');
const {productProofReview,validateProductProof}=require('../dist/hinkal-product-proof.cjs');
const {localProductProvingSupported}=require('../dist/hinkal-product-result.cjs');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function installProductProofUi(c){
 let pending,epoch=0;
 const clear=()=>{pending=undefined;epoch++;};
 const scope=()=>({epoch,window:c.getWindow(),vault:c.getVault(),wallet:structuredClone(c.getPublic())});
 const current=s=>{const w=c.getPublic();if(s.epoch!==epoch||!s.window||s.window.isDestroyed?.()||s.window!==c.getWindow()||s.vault!==c.getVault()||digest(w)!==digest(s.wallet))throw Error('Private proof review was canceled because the review, wallet or window changed.');};
 async function prepare(request,s){
  c.policy.assertProductProof(request);current(s);
  const review=await c.job({action:'review-product-proof',request,vault:s.vault});current(s);
  await c.requestStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});current(s);
  pending={token:randomUUID(),request:structuredClone(request),review,vaultHash:digest(s.vault)};
  return {token:pending.token,review,requestCreatedAt:request.createdAt};
 }
 c.register('import-product-proof',async()=>{
  c.clearOtherReview();clear();const s=scope();
  const picked=await c.openJSON('Import private-proof request');if(!picked)return {cancelled:true};current(s);
  return prepare(picked.data,s);
 });
 c.register('review-product-proof',async p=>{
  c.clearOtherReview();clear();const s=scope();
  const record=await c.requestStore.load(s.wallet.deviceId,p?.id);current(s);
  if(!record)throw Error('Private-proof request is unavailable for this wallet.');
  return prepare(record.request,s);
 });
 c.register('sign-product-proof',async p=>{
  const s=scope();if(!c.backupVerified())throw Error('Verify a separate encrypted backup before authorizing a private proof.');
  const r=pending;
  if(!r||p?.token!==r.token||p?.fingerprint!==r.request.fingerprint||digest(s.vault)!==r.vaultHash)throw Error('Private-proof review expired or changed. Import it again.');
  c.policy.assertProductProof(r.request);clear();c.clearOtherReview();s.epoch=epoch;
  const password=c.passwordOf(p?.password);await c.ready();current(s);
  const review=await c.job({action:'review-product-proof',request:r.request,vault:s.vault});current(s);
  const approval=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Authorize this exact private proof?',
   message:'Create a private-proof authorization?',detail:Object.entries(review).map(([k,v])=>k+': '+v).join('\n')+
   '\n\nThis does not sign or broadcast a blockchain transaction. Review the resulting transaction separately.',
   buttons:['Cancel','Authorize exact private proof'],defaultId:0,cancelId:0,noLink:true});current(s);
  if(approval.response!==1)return {cancelled:true,reviewConsumed:true};
  // Recheck the monotonic expiry and exact request in the one-use offline child.
  await c.job({action:'verify',vault:s.vault,password});current(s);validateProductProof(r.request);
  const {response}=await c.signingAttempts.run({walletId:s.wallet.deviceId,request:r.request,authority:'private-proof',
   current:()=>{current(s);validateProductProof(r.request);},
   verify:async(response,request,authority)=>(await c.job({action:authority==='private-proof'?'verify-product-proof':'verify-saved',vault:s.vault,request,response})).response,
   sign:request=>c.job({action:'sign-product-proof',vault:s.vault,password,request,fingerprint:request.fingerprint})});
  current(s);
  const file=await c.saveJSON('Export private-proof authorization','drivekey-private-proof-response.json',response);current(s);
  return {kind:'private-proof',saved:!!file,reviewConsumed:true,recoverable:true,authorizationFingerprint:r.request.fingerprint,
   warning:file?'Private-proof authorization exported. Generate and verify the proof, then review the chain transaction separately.':'Export canceled. The same private-proof authorization is recoverable from Saved proof authorizations. No chain transaction was signed or broadcast.'};
 });
 c.register('list-product-proofs',async()=>{
  const s=scope(),requests=await c.requestStore.list(s.wallet.deviceId),authorized=await c.signingAttempts.list(s.wallet.deviceId,'private-proof');current(s);
  const all=new Map(requests.map(record=>[record.request.fingerprint,record.request]));
  for(const record of authorized)all.set(record.request.fingerprint,record.request);
  const rows=[];
  for(const [id,request]of all){
   validateProductProof(request,Date.now(),false);
   const entry=authorized.find(record=>record.request.fingerprint===id),signed=entry?.response?entry:null;
   if(signed)await c.job({action:'verify-product-proof',vault:s.vault,request,response:signed.response});current(s);
   const proved=await c.resultStore.load(s.wallet.deviceId,id.slice(2));current(s);
   if(proved){if(!signed)throw Error('Private proof recovery is missing its original authorization. Preserve this profile.');await c.job({action:'verify-product-proof-result',vault:s.vault,request,response:signed.response,result:proved.response});current(s);}
   const review=productProofReview(request,Date.now(),false);
   rows.push({id,state:entry?.uncertain?'signing-uncertain':proved?'proved':signed?'authorized':'prepared',localProvingSupported:localProductProvingSupported(request),chain:review.chain,action:review.action,amount:review.amount,asset:review.inputAsset,
    recipient:review.recipient,expiresAt:request.expiresAt,createdAt:request.createdAt,requiresSeparateChainReview:true});
  }
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 });
 c.register('export-product-proof',async p=>{
  const s=scope(),record=await c.signingAttempts.recover(s.wallet.deviceId,String(p?.id||'').replace(/^0x/,''),'private-proof',async(response,request)=>(await c.job({action:'verify-product-proof',vault:s.vault,request,response})).response);current(s);
  if(!record)throw Error('Private-proof authorization is unavailable for this wallet.');
  c.policy.assertProductProof(record.request);
  const {response}=await c.job({action:'verify-product-proof',vault:s.vault,request:record.request,response:record.response});current(s);
  const file=await c.saveJSON('Export saved private-proof authorization','drivekey-private-proof-response.json',response);current(s);
  return {saved:!!file,kind:'private-proof',authorizationFingerprint:record.request.fingerprint};
 });
 c.register('prove-product-proof',async p=>{
  c.clearOtherReview();clear();const s=scope();
  if(!c.backupVerified())throw Error('Verify a separate encrypted backup before creating a private proof.');
  const password=c.passwordOf(p?.password),id=String(p?.id||'').replace(/^0x/,'');
  const record=await c.signingAttempts.recover(s.wallet.deviceId,id,'private-proof',async(response,request)=>(await c.job({action:'verify-product-proof',vault:s.vault,request,response})).response);current(s);
  if(!record)throw Error('Authorize the private proof request before generating a proof.');
  c.policy.assertProductProof(record.request);
  if(!localProductProvingSupported(record.request))throw Error('This proof profile still requires its supported provider finalizer. No local replacement was made.');
  const review=await c.job({action:'review-product-proof',vault:s.vault,request:record.request});current(s);
  await c.job({action:'verify-product-proof',vault:s.vault,request:record.request,response:record.response});current(s);
  const approval=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Generate this exact private proof?',message:'Generate the previously authorized proof offline?',
   detail:Object.entries(review).map(([k,v])=>k+': '+v).join('\n')+'\n\nThe local prover reconstructs your owned notes and verifies the resulting proof. A blockchain transaction still requires a separate review and signature.',
   buttons:['Cancel','Generate exact private proof'],defaultId:0,cancelId:0,noLink:true});current(s);
  if(approval.response!==1)return {cancelled:true};
  await c.ready();current(s);
  const previous=await c.resultStore.load(s.wallet.deviceId,id);current(s);let result;
  if(previous)result=(await c.job({action:'verify-product-proof-result',vault:s.vault,request:record.request,response:record.response,result:previous.response})).result;
  else{
   result=await c.job({action:'prove-product-proof',vault:s.vault,password,request:record.request,response:record.response,artifactDirectory:c.artifactDirectory()},'product-proof-worker.cjs');
   // Preserve a completed proof even if the owner closes or invalidates its UI.
   try{result=(await c.resultStore.save(s.wallet.deviceId,record.request,result)).response;}
   catch{throw Error('Could not preserve encrypted proof recovery. No proof was exported. Preserve this profile.');}
  }
  current(s);return {kind:'private-proof-result',proved:true,reused:!!previous,authorizationFingerprint:record.request.fingerprint,requiresSeparateChainReview:true};
 });
 c.register('export-product-proof-result',async p=>{
  const s=scope(),id=String(p?.id||'').replace(/^0x/,'');
  const record=await c.signingAttempts.recover(s.wallet.deviceId,id,'private-proof',async(response,request)=>(await c.job({action:'verify-product-proof',vault:s.vault,request,response})).response),proved=await c.resultStore.load(s.wallet.deviceId,id);current(s);
  if(!record||!proved)throw Error('The proof or its original authorization is unavailable. Preserve this profile.');
  c.policy.assertProductProof(record.request);
  const {result}=await c.job({action:'verify-product-proof-result',vault:s.vault,request:record.request,response:record.response,result:proved.response});current(s);
  const file=await c.saveJSON('Export existing private proof','drivekey-private-proof.json',{version:28,kind:'drivekey-hinkal-product-proof-package',request:record.request,response:record.response,result});current(s);
  return {saved:!!file,kind:'private-proof-result',authorizationFingerprint:record.request.fingerprint,requiresSeparateChainReview:true};
 });
 return {clear};
}
module.exports={installProductProofUi};
