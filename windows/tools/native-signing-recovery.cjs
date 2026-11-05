'use strict';
// Restores existing authority only. The renderer receives metadata, never bytes.
const {isDeepStrictEqual}=require('node:util');
function installSigningRecovery(c){
 let epoch=0;const clear=()=>{epoch++;};
 c.register('recover-signing-response',async p=>{
  if(!p||Object.keys(p).sort().join(',')!=='authority,id'||!['transaction','private-proof'].includes(p.authority)||typeof p.id!=='string'||!/^(?:0x)?[a-f0-9]{64}$/.test(p.id))throw Error('Choose an existing signing attempt for recovery.');
  c.clearPending();clear();const s={epoch,window:c.getWindow(),wallet:structuredClone(c.getPublic()),vault:c.getVault(),vaultHash:c.getVaultHash()},id=p.id.replace(/^0x/,'');
  const current=()=>{if(s.epoch!==epoch||!s.window||s.window.isDestroyed?.()||c.getWindow()!==s.window||c.getVault()!==s.vault||c.getVaultHash()!==s.vaultHash||!isDeepStrictEqual(c.getPublic(),s.wallet))throw Error('Signing-response recovery was canceled because the wallet, review or window changed.');};
  const original=await c.attempts.inspect(s.wallet.deviceId,id,p.authority);current();
  const picked=await c.openJSON('Recover the original signed response');current();if(!picked)return {cancelled:true};
  const candidate=await c.attempts.matchOriginal(s.wallet.deviceId,id,p.authority,picked.data);current();
  if(!isDeepStrictEqual(candidate.request,original.request)||!isDeepStrictEqual(candidate.commitment,original.commitment))throw Error('The original recovery journal changed. Preserve this profile.');
  const checked=await c.verify(candidate.response,original.request,p.authority,s);current();
  const confirmation=await c.dialog.showMessageBox(s.window,{type:'warning',title:'Recover the original signing response?',message:'Restore these previously approved bytes?',
   detail:Object.entries(checked.review).map(([k,v])=>k+': '+v).join('\n')+'\nOriginal response commitment: '+original.commitment.responseHash+
    '\n\nRecovery must match the retained original commitment. This creates no signature, changes no request and broadcasts nothing. Application expiry does not revoke previously signed bytes.',
   buttons:['Cancel','Recover original response'],defaultId:0,cancelId:0,noLink:true});current();
  if(confirmation.response!==1)return {cancelled:true};
  const restored=await c.attempts.restore({walletId:s.wallet.deviceId,id,authority:p.authority,response:picked.data,current,
   verify:async(response,request,authority)=>(await c.verify(response,request,authority,s)).response});current();
  return {restored:true,reused:restored.reused,authority:p.authority,fingerprint:original.request.fingerprint,transactionHash:restored.response.transactionHash,
   warning:'Original response recovered. No signature was created and no transaction was broadcast.'};
 });
 return {clear};
}
module.exports={installSigningRecovery};
