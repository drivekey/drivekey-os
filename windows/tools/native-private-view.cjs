'use strict';
// Native file handoffs only. Renderer results contain public review metadata.
const {randomUUID,createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {validateViewRequest,viewFingerprint,assertViewWallet,viewReview,verifyViewResponse}=require('../dist/hinkal-view.cjs');
const {createViewTransport}=require('../dist/hinkal-view-crypto.cjs');
const {validateProductProof,productProofReview}=require('../dist/hinkal-product-proof.cjs');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function installPrivateView(c){
 let epoch=0,pending;const busy=new Set(),clear=()=>{epoch++;pending=undefined;};
 const scope=()=>({epoch,window:c.getWindow(),wallet:structuredClone(c.getPublic()),vault:c.getVault()});
 const current=s=>{if(s.epoch!==epoch||!s.window||s.window.isDestroyed?.()||s.window!==c.getWindow()||s.vault!==c.getVault()||!isDeepStrictEqual(s.wallet,c.getPublic()))throw Error('Private view operation canceled because the wallet, review or window changed.');};
 const check=(r,s,expiry=true)=>{const request=validateViewRequest(r,Date.now(),expiry);assertViewWallet(request,s.wallet);return request;};
 const idOf=p=>{const id=String(p?.id||'').replace(/^0x/,'');if(!/^[a-f0-9]{64}$/.test(id))throw Error('Choose an existing private view request.');return id;};
 const verify=s=>async(response,request,authority)=>{
  const action=authority==='private-view'?'verify-private-view':authority==='private-proof'?'verify-product-proof':'verify-saved';
  return (await c.job({action,request,response,vault:s.vault,wallet:s.wallet},'worker.cjs',{owner:s.window})).response;
 };
 async function requestRecord(s,id){const record=await c.requestStore.load(s.wallet.deviceId,'0x'+id);current(s);if(!record)throw Error('Original private view request is unavailable. Preserve this profile.');check(record.request,s,false);return record;}
 function checkedPreparation(request,response,input){
  if(input?.version!==30||input.kind!=='drivekey-hinkal-view-preparation'||input.deviceId!==request.deviceId||input.requestId!==request.requestId||input.fingerprint!==request.fingerprint||input.blockchainTransactionSigned!==false||input.submitted!==false)throw Error('Private preparation response differs.');
  const product=validateProductProof(input.productRequest,Date.now(),false),seed=product.seed;
  if(!isDeepStrictEqual(seed.job.context,request.context)||!isDeepStrictEqual(product.wallet,request.wallet)||seed.version!==request.profile||seed.maximumFee!==request.maximumFee||
   (request.profile===13?seed.nonce!==request.nonce:seed.maximumAccountRent!==request.maximumAccountRent)||Date.parse(product.expiresAt)>Date.parse(request.expiresAt)||Date.parse(product.createdAt)<Date.parse(response.authorizedAt))throw Error('Private proof preparation changed its original scope.');
  return product;
 }
 c.register('create-private-view',async p=>{
  if(c.isOffline())throw Error('Create the viewing request on the online computer.');c.clearPending();clear();const s=scope();c.policy.assertPrivateView();
  if(!p||Object.keys(p).sort().join(',')!=='context,maximumAccountRent,maximumFee,nonce,profile')throw Error('Private preparation draft fields differ.');
  const transport=createViewTransport(),now=Date.now(),request={version:30,kind:'drivekey-hinkal-view-request',requestId:randomUUID(),deviceId:s.wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),wallet:s.wallet,...structuredClone(p),transportPublicKey:transport.transportPublicKey,fingerprint:''};request.fingerprint=viewFingerprint(request);check(request,s);
  await c.ready();current(s);
  // Private transport key is encrypted before the public request can escape.
  await c.sessionStore.claim(s.wallet.deviceId,request,{version:30,kind:'private-view-transport-session',deviceId:request.deviceId,requestId:request.requestId,fingerprint:request.fingerprint,privateKey:transport.privateKey});transport.privateKey='';
  await c.requestStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});current(s);
  const file=await c.saveJSON('Transfer private view request to offline Companion','drivekey-private-view-request.json',request);current(s);
  return {saved:!!file,id:request.fingerprint,review:viewReview(request),recoverable:true};
 });
 c.register('import-private-view-request',async()=>{
  if(!c.isOffline())throw Error('Authorize viewing access in the offline Companion.');c.clearPending();clear();const s=scope();c.policy.assertPrivateView();
  if(!s.vault)throw Error('Open the matching encrypted vault.');const picked=await c.openJSON('Import private view request');current(s);if(!picked)return {cancelled:true};
  const request=check(picked.data,s);await c.ready();current(s);await c.requestStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});current(s);
  pending={token:randomUUID(),request,vaultHash:digest(s.vault)};return {token:pending.token,id:request.fingerprint,review:viewReview(request)};
 });
 c.register('authorize-private-view',async p=>{
  if(!c.isOffline())throw Error('Viewing access is authorized in the offline Companion.');const s=scope(),r=pending;
  if(!c.backupVerified())throw Error('Verify a separate encrypted backup before authorizing viewing access.');
  if(!r||p?.token!==r.token||p?.fingerprint!==r.request.fingerprint||digest(s.vault)!==r.vaultHash)throw Error('Private view review expired or changed.');
  check(r.request,s);c.policy.assertPrivateView(r.request);clear();c.clearPending();s.epoch=epoch;const password=c.passwordOf(p.password),review=viewReview(r.request);
  const approval=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Authorize this encrypted private view?',message:'Allow the requesting computer to read this private account?',detail:Object.entries(review).map(([k,v])=>k+': '+v).join('\n')+'\n\nCompare the complete request fingerprint and transport key with your online computer. This discloses sensitive viewing access. It does not authorize a circuit proof, sign a transaction or submit funds.',buttons:['Cancel','Authorize encrypted viewing access'],defaultId:0,cancelId:0,noLink:true});current(s);
  if(approval.response!==1)return {cancelled:true,reviewConsumed:true};await c.job({action:'verify',vault:s.vault,password},'worker.cjs',{owner:s.window});current(s);check(r.request,s);await c.ready();current(s);
  const {response}=await c.attempts.run({walletId:s.wallet.deviceId,request:r.request,authority:'private-view',current:()=>{current(s);check(r.request,s);},verify:verify(s),sign:request=>c.job({action:'authorize-private-view',vault:s.vault,password,request,fingerprint:request.fingerprint},'worker.cjs',{owner:s.window})});current(s);
  const file=await c.saveJSON('Return encrypted private view to the requesting computer','drivekey-private-view-response.json',response);current(s);return {saved:!!file,id:r.request.fingerprint,recoverable:true,viewAuthorized:true};
 });
 c.register('export-private-view-request',async p=>{c.clearPending();clear();const s=scope(),record=await requestRecord(s,idOf(p));const file=await c.saveJSON('Export original private view request','drivekey-private-view-request.json',record.request);current(s);return {saved:!!file};});
 c.register('export-private-view-response',async p=>{
  c.clearPending();clear();const s=scope(),id=idOf(p),original=await requestRecord(s,id),record=await c.attempts.recover(s.wallet.deviceId,id,'private-view',verify(s));current(s);
  if(!record)throw Error('Original encrypted viewing response is unavailable. Preserve this profile.');verifyViewResponse(original.request,record.response,Date.now(),false);
  const file=await c.saveJSON('Export original encrypted private view','drivekey-private-view-response.json',record.response);current(s);return {saved:!!file};
 });
 c.register('import-private-view-response',async()=>{
  if(c.isOffline())throw Error('Import the encrypted view on its requesting computer.');c.clearPending();clear();const s=scope();c.policy.assertPrivateView();
  const picked=await c.openJSON('Import encrypted private view response');current(s);if(!picked)return {cancelled:true};const id=idOf({id:picked.data?.fingerprint}),record=await requestRecord(s,id),request=check(record.request,s),session=await c.sessionStore.load(s.wallet.deviceId,id);current(s);
  if(!session||!isDeepStrictEqual(session.request,request))throw Error('Original private transport session is unavailable. Preserve this profile.');const response=verifyViewResponse(request,picked.data);
  await c.responseStore.save(s.wallet.deviceId,request,response);current(s);return {imported:true,id:request.fingerprint,review:viewReview(request)};
 });
 c.register('prepare-private-view-job',async p=>{
  if(c.isOffline())throw Error('The offline Companion cannot contact a proof provider.');c.clearPending();clear();const s=scope(),id=idOf(p),lock=s.wallet.deviceId+id;
  if(busy.has(lock))throw Error('This private proof preparation is already running.');busy.add(lock);
  try{c.policy.assertPrivateView();const original=await requestRecord(s,id),request=original.request,responseRecord=await c.responseStore.load(s.wallet.deviceId,id),saved=await c.preparationStore.load(s.wallet.deviceId,id);current(s);
   if(!responseRecord||!isDeepStrictEqual(responseRecord.request,request))throw Error('The original encrypted view response is required.');const response=verifyViewResponse(request,responseRecord.response,Date.now(),false);
   if(saved){const product=checkedPreparation(request,response,saved.response);return {prepared:true,reused:true,id:request.fingerprint,review:productProofReview(product,Date.now(),false)};}
   check(request,s);const session=await c.sessionStore.load(s.wallet.deviceId,id);current(s);if(!session||!isDeepStrictEqual(session.request,request))throw Error('Original private transport key is unavailable. Preserve this profile.');
   const confirmation=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Prepare this exact private proof?',message:'Contact Hinkal to prepare this private operation?',detail:Object.entries(viewReview(request)).map(([k,v])=>k+': '+v).join('\n')+'\n\nThe isolated network worker will decrypt the approved viewing capability. The offline Companion must separately review and authorize the resulting proof. No transaction is signed or submitted.',buttons:['Cancel','Prepare exact private proof'],defaultId:0,cancelId:0,noLink:true});current(s);if(confirmation.response!==1)return {cancelled:true};check(request,s);await c.ready();current(s);
   const claim=await c.jobAttemptStore.claim(s.wallet.deviceId,request,{version:30,kind:'private-view-provider-attempt',deviceId:request.deviceId,requestId:request.requestId,fingerprint:request.fingerprint});if(!claim.created)throw Error('Provider preparation outcome is uncertain. Preserve this original session; no automatic repeat is allowed.');current(s);
   let result;try{result=await c.job({action:'prepare-scoped-private-proof',input:{request,response,transportPrivateKey:session.response.privateKey},wallet:s.wallet},'product-view-worker.cjs',{owner:s.window});}finally{session.response.privateKey=undefined;}
   // Retain the completed public job before any later owner/window check.
   const product=checkedPreparation(request,response,result);await c.preparationStore.save(s.wallet.deviceId,request,result);await c.proofRequestStore.put({version:1,request:product,state:'prepared',updatedAt:new Date().toISOString()});current(s);
   return {prepared:true,reused:false,id:request.fingerprint,review:productProofReview(product,Date.now(),false)};
  }finally{busy.delete(lock);}
 });
 c.register('export-private-view-job',async p=>{c.clearPending();clear();const s=scope(),id=idOf(p),original=await requestRecord(s,id),response=await c.responseStore.load(s.wallet.deviceId,id),saved=await c.preparationStore.load(s.wallet.deviceId,id);current(s);if(!response||!saved)throw Error('The original prepared proof is unavailable. Preserve this profile.');const product=checkedPreparation(original.request,verifyViewResponse(original.request,response.response,Date.now(),false),saved.response);const file=await c.saveJSON('Transfer unsigned private proof request to offline Companion','drivekey-private-proof-request.json',product);current(s);return {saved:!!file};});
 c.register('list-private-views',async()=>{
  const s=scope(),records=await c.requestStore.list(s.wallet.deviceId),responses=await c.attempts.list(s.wallet.deviceId,'private-view'),rows=[];current(s);
  for(const record of records){const request=check(record.request,s,false),id=request.fingerprint.slice(2),response=responses.find(r=>r.request.fingerprint===request.fingerprint),prepared=await c.preparationStore.load(s.wallet.deviceId,id),attempt=await c.jobAttemptStore.load(s.wallet.deviceId,id);current(s);const proofId=prepared?.response?.productRequest?.fingerprint,proofAuthorization=proofId?await c.proofAuthorizationStore?.load(s.wallet.deviceId,proofId.slice(2)):null,proofResult=proofId?await c.proofResultStore?.load(s.wallet.deviceId,proofId.slice(2)):null;current(s);rows.push({proofId,hasProofAuthorization:!!proofAuthorization,hasProofResult:!!proofResult,id:request.fingerprint,createdAt:request.createdAt,expiresAt:request.expiresAt,review:viewReview(request,Date.now(),false),state:response?.uncertain?'signing-uncertain':prepared?'prepared':attempt?'provider-uncertain':response?'view-authorized':'requested',canRecoverOriginal:!!response?.canRecoverOriginal,hasResponse:!!response&&!response.uncertain,hasPreparedJob:!!prepared});}
  return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 });
 return {clear};
}
module.exports={installPrivateView};
