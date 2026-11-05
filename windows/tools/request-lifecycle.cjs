'use strict';
// Handoff state is offchain evidence. Expiry never proves absence of a signature.
const {isDeepStrictEqual}=require('node:util');
const exposed=new Set(['external-seen','export-started','exported']),versions=new Set([8,9,10,11,12,22,23,24,25,26]);
function validateHandoff(h){
 if(!h||h.version!==1||!['local-preparation','external-import','legacy-unknown'].includes(h.origin)||!['local-only',...exposed].includes(h.state)||Object.keys(h).some(k=>!['version','origin','state','via','startedAt','completedAt'].includes(k)))throw Error('Invalid request handoff record. Preserve this profile.');
 if(h.state==='local-only'){
  if(h.origin!=='local-preparation'||h.via!==undefined||h.startedAt!==undefined||h.completedAt!==undefined)throw Error('A local draft cannot erase handoff evidence.');
 }else if(!['file','exchange','import'].includes(h.via)||typeof h.startedAt!=='string'||!Number.isSafeInteger(Date.parse(h.startedAt)))throw Error('Invalid handoff start evidence.');
 if(h.state==='exported'?(typeof h.completedAt!=='string'||!Number.isSafeInteger(Date.parse(h.completedAt))||Date.parse(h.completedAt)<Date.parse(h.startedAt)):h.completedAt!==undefined)throw Error('Invalid handoff completion evidence.');return h;
}
function assertHandoffTransition(old,next){
 if(next!==undefined)validateHandoff(next);
 if(old===undefined){if(next?.state==='local-only')throw Error('Earlier records cannot be reclassified as unexposed local drafts.');return;}
 validateHandoff(old);if(next===undefined||next.origin!==old.origin||old.via!==undefined&&next.via!==old.via||old.startedAt!==undefined&&next.startedAt!==old.startedAt||old.completedAt!==undefined&&next.completedAt!==old.completedAt)throw Error('Original handoff evidence is immutable.');
 if(old.state!=='local-only'&&next.state==='local-only'||old.state==='exported'&&next.state!=='exported'||old.state==='export-started'&&next.state==='external-seen')throw Error('Request exposure cannot be reset.');
}
function preparedRecord(request,extra={}){return {...extra,version:1,request,state:'prepared',handoff:{version:1,origin:'local-preparation',state:'local-only'},updatedAt:new Date().toISOString()};}
function discardableShape(r){
 const q=r?.request;return !!q&&r.state==='prepared'&&!r.response&&r.handoff?.origin==='local-preparation'&&r.handoff?.state==='local-only'&&versions.has(q.version)&&
  r.productProof===undefined&&q.proofAuthorization===undefined&&q.proofFingerprint===undefined&&!(q.inputNotes?.length)&&
  (q.version!==10||['hinkal-approve','hinkal-revoke'].includes(q.action));
}
function installRequestLifecycle(c){
 let epoch=0;const clear=()=>{epoch++;};
 const scope=()=>({epoch,window:c.getWindow(),wallet:structuredClone(c.getPublic())});
 const current=s=>{if(s.epoch!==epoch||!s.window||s.window.isDestroyed?.()||s.window!==c.getWindow()||!isDeepStrictEqual(s.wallet,c.getPublic()))throw Error('Draft operation was canceled because the wallet, review or window changed.');};
 async function recordFor(request,s){const r=await c.store.load(s.wallet.deviceId,request.fingerprint);current(s);if(!r||!isDeepStrictEqual(r.request,request))throw Error('The original prepared request is missing or differs. Preserve this profile.');return r;}
 async function start(request,via,s){
  const r=await recordFor(request,s);if(r.state!=='prepared'||r.response)throw Error('This request may already be signed. Recover its original response instead of exporting another unsigned request.');
  await c.attempts.assertUnstarted(s.wallet.deviceId,request.fingerprint.slice(2));current(s);
  const h=r.handoff||{version:1,origin:'legacy-unknown',state:'external-seen',via,startedAt:new Date().toISOString()};
  const handoff=h.state==='local-only'?{...h,state:'export-started',via,startedAt:new Date().toISOString()}:h.state==='external-seen'?{...h,state:'export-started'}:h;
  await c.store.put({...r,handoff,updatedAt:new Date().toISOString()});current(s);
 }
 async function completed(request,s){
  const r=await recordFor(request,s),h=r.handoff;if(!h||h.state==='local-only')throw Error('The handoff start was not preserved. Keep the original files.');
  if(h.state!=='exported')await c.store.put({...r,handoff:{...h,state:'exported',completedAt:new Date().toISOString()},updatedAt:new Date().toISOString()});
 }
 async function exportRequest(request,write,via='file'){
  const s=scope();await recordFor(request,s);let started=false;
  const beforeWrite=async()=>{await start(request,via,s);started=true;};
  const result=await write(beforeWrite);if(started&&result)await completed(request,s);current(s);return result;
 }
 async function imported(request){
  const s=scope(),old=await c.store.load(s.wallet.deviceId,request.fingerprint);current(s);
  if(old?.state==='discarded')throw Error('This discarded local draft cannot be activated again. Preserve the original record.');
  if(old&&!isDeepStrictEqual(old.request,request))throw Error('Imported request differs from its original journal.');
  const h=old?.handoff;
  if(h&&h.state!=='local-only')return;
  const handoff={version:1,origin:h?.origin||'external-import',state:'external-seen',via:'import',startedAt:new Date().toISOString()};
  await c.store.put({...old,version:1,request,state:old?.state||'prepared',handoff,updatedAt:new Date().toISOString()});current(s);
 }
 async function canDiscard(record,wallet){
  if(!discardableShape(record)||record.request.deviceId!==wallet.deviceId)return false;
  try{await c.attempts.assertUnstarted(wallet.deviceId,record.request.fingerprint.slice(2));return true;}catch{return false;}
 }
 c.register('discard-prepared-request',async p=>{
  if(!p||Object.keys(p).join(',')!=='id'||!/^0x[a-f0-9]{64}$/.test(p.id))throw Error('Choose an existing local draft.');
  c.clearPending();clear();const s=scope(),r=await c.store.load(s.wallet.deviceId,p.id);current(s);
  if(!discardableShape(r))throw Error('Only a known local draft that has never left this profile and has no prior authority can be discarded. Preserve exported, imported, legacy and private-authorized requests.');
  await c.attempts.assertUnstarted(s.wallet.deviceId,p.id.slice(2));current(s);const review=c.review(r.request);
  const approval=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Discard this unsent local draft?',message:'Keep its history and discard this unsigned step?',detail:Object.entries(review).map(([k,v])=>k+': '+v).join('\n')+'\n\nThis does not revoke an exported request, signature, prior approval or onchain route. No transaction is signed or submitted. Prepare any new quote as a separate request.',buttons:['Cancel','Discard local draft'],defaultId:0,cancelId:0,noLink:true});current(s);
  if(approval.response!==1)return {cancelled:true};
  const latest=await c.store.load(s.wallet.deviceId,p.id);current(s);if(!isDeepStrictEqual(latest,r))throw Error('The draft changed during review. Preserve its records.');
  await c.store.put({...r,state:'discarded',discardedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});current(s);return {discarded:true,id:p.id,requiresFreshReview:true};
 });
 return {clear,exportRequest,imported,canDiscard};
}
module.exports={validateHandoff,assertHandoffTransition,preparedRecord,discardableShape,installRequestLifecycle};
