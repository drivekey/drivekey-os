'use strict';
// Append-only private-input holds. No expiry/cancel/reset/release endpoint.
// Settlement and portable recovery must be independently verified separately.
const fs=require('node:fs/promises'),path=require('node:path'),{isDeepStrictEqual}=require('node:util'),{createHash}=require('node:crypto');
const {SignatureStore}=require('../signature-store.cjs'),{validateProductProof}=require('../dist/hinkal-product-proof.cjs'),{validatePrivateNoteManifest}=require('../dist/private-note-manifest.cjs'),{validateProductChain}=require('../dist/hinkal-product-chain.cjs');
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x),digest=x=>createHash('sha256').update(canonical(x)).digest('hex'),snapshot=x=>JSON.parse(JSON.stringify(x));
const missing='Private-note reservation state is missing, mismatched or uncertain. Preserve all original proof/signing journals; new wallet signing is disabled.',locked='Private-note reservation lock is active or interrupted. Preserve this profile; do not repeat signing or remove the lock.';
function privateTransaction(r){return r?.version===29||[16,18,21].includes(r?.version)||r?.version===10&&!['hinkal-approve','hinkal-revoke'].includes(r?.action);}
class PrivateNoteClaims{
 constructor(directory,storage,{io=fs}={}){this.directory=path.resolve(directory);this.fs=io;this.claims=new SignatureStore(path.join(directory,'private-note-claims-v1'),storage.forJournal('private-note-claims'));this.chains=new SignatureStore(path.join(directory,'private-note-chains-v1'),storage.forJournal('private-note-chains'));this.lockCodec=storage.forJournal('private-note-locks');}
 lockFile(wallet){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wallet))throw Error('Invalid private-note wallet.');return path.join(this.directory,'private-note-locks-v1','00000000-0000-4000-8000-000000000000','0'.repeat(64)+'.bin');}
 async assertUnlocked(wallet){this.lockFile(wallet);const root=path.join(this.directory,'private-note-locks-v1');try{for(const entry of await this.fs.readdir(root,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink()||(await this.fs.readdir(path.join(root,entry.name))).length)throw Error(locked);}}catch(e){if(e.code!=='ENOENT')throw e;}}
 claimResponse(request,manifest){return {version:1,kind:'drivekey-private-note-claim',deviceId:request.deviceId,requestId:request.requestId,fingerprint:request.fingerprint,manifest};}
 checkedClaim(record){const r=validateProductProof(record.request,Date.now(),false),m=validatePrivateNoteManifest(r,record.response?.manifest,Date.now(),false);if(!isDeepStrictEqual(record.response,this.claimResponse(r,m)))throw Error(missing);return {request:r,manifest:m};}
 bindingResponse(proof,chain){return {version:1,kind:'drivekey-private-note-chain-binding',deviceId:proof.deviceId,requestId:proof.requestId,fingerprint:proof.fingerprint,chainFingerprint:chain.fingerprint,chainRequestHash:digest(chain),chainRequest:chain};}
 checkedBinding(record){const proof=validateProductProof(record.request,Date.now(),false),chain=validateProductChain(record.response?.chainRequest,Date.now(),false);if(!isDeepStrictEqual(chain.package.request,proof)||!isDeepStrictEqual(record.response,this.bindingResponse(proof,chain)))throw Error(missing);return {proof,chain};}
 async holdings(wallet){return (await this.claims.list(wallet)).map(r=>this.checkedClaim(r));}
 async allHoldings(){const root=this.claims.directory,info=await this.fs.lstat(root).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!info)return [];if(!info.isDirectory()||info.isSymbolicLink())throw Error(missing);const entries=await this.fs.readdir(root,{withFileTypes:true});if(entries.length>1000)throw Error(missing);const rows=[];for(const entry of entries){if(!entry.isDirectory()||entry.isSymbolicLink())throw Error(missing);this.claims.location(entry.name,'0'.repeat(64));rows.push(...await this.holdings(entry.name));}return rows;}
 async check(wallet,request,authority,manifest){
  request=snapshot(request);manifest=manifest===undefined?undefined:snapshot(manifest);
  await this.assertUnlocked(wallet);if(wallet!==request.deviceId)throw Error(missing);
  if(authority==='private-proof'){
   const r=validateProductProof(request),m=validatePrivateNoteManifest(r,manifest),holdings=await this.allHoldings(),existing=holdings.find(x=>x.request.fingerprint===r.fingerprint);
   if(existing){if(!isDeepStrictEqual(existing.request,r)||!isDeepStrictEqual(existing.manifest,m))throw Error(missing);return m;}
   for(const held of holdings)if(held.manifest.chain===m.chain&&held.manifest.inputs.some(n=>m.inputs.some(x=>x.commitment===n.commitment||x.nullifier===n.nullifier)))throw Error('These private inputs are already reserved by an original proof authorization. Expiry or cancellation does not release them.');return m;
  }
  if(authority==='transaction'&&privateTransaction(request)){
   if(request.version!==29)throw Error('New private transaction signing requires its complete original product approval envelope. Earlier records remain readable.');
   const chain=validateProductChain(request),proof=chain.package.request,record=await this.claims.load(wallet,proof.fingerprint.slice(2));if(!record)throw Error(missing);const held=this.checkedClaim(record);if(!isDeepStrictEqual(held.request,proof))throw Error(missing);const bound=await this.chains.load(wallet,proof.fingerprint.slice(2));if(bound&&!isDeepStrictEqual(this.checkedBinding(bound).chain,chain))throw Error('This proof is already bound to its original chain signing request. Preserve it; no replacement approval is available.');return held.manifest;
  }
  return null;
 }
 async withLock(wallet,operation){
  const file=this.lockFile(wallet),sealed=await this.lockCodec.seal(JSON.stringify({version:1,kind:'private-note-exclusive-lock',deviceId:wallet}));await this.fs.mkdir(path.dirname(file),{recursive:true});let handle;
  try{handle=await this.fs.open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error(locked);throw e;}
  let completed=false;try{await handle.writeFile(sealed);await handle.sync();await handle.close();handle=null;const result=await operation();completed=true;return result;}
  finally{if(handle)await handle.close().catch(()=>{});if(completed){const current=await this.fs.readFile(file);if(!current.equals(sealed))throw Error(locked);await this.fs.unlink(file);}}
 }
 async reserve(wallet,request,authority,manifest){
  const r=snapshot(request),originalManifest=manifest===undefined?undefined:snapshot(manifest),m=await this.check(wallet,r,authority,originalManifest);if(!m)return null;
  // Recheck every hold under a filesystem-exclusive, encrypted recoverable lock.
  // The lock is preserved on any failure or interrupted publication.
  return this.withLock(wallet,async()=>{
   if(authority==='private-proof'){
    const holdings=await this.allHoldings(),existing=holdings.find(x=>x.request.fingerprint===r.fingerprint);if(existing){if(!isDeepStrictEqual(existing.request,r)||!isDeepStrictEqual(existing.manifest,m))throw Error(missing);return m;}
    for(const held of holdings)if(held.manifest.chain===m.chain&&held.manifest.inputs.some(n=>m.inputs.some(x=>x.commitment===n.commitment||x.nullifier===n.nullifier)))throw Error('Private input reservation conflicts. Preserve both requests and the interrupted lock.');
    const saved=await this.claims.claim(wallet,r,this.claimResponse(r,m));if(!saved.created||!isDeepStrictEqual(this.checkedClaim(saved.record).manifest,m))throw Error(missing);return m;
   }
   const proof=r.package.request,held=await this.claims.load(wallet,proof.fingerprint.slice(2));if(!held||!isDeepStrictEqual(this.checkedClaim(held).request,proof))throw Error(missing);const saved=await this.chains.claim(wallet,proof,this.bindingResponse(proof,r));if(!isDeepStrictEqual(this.checkedBinding(saved.record).chain,r))throw Error(missing);return m;
  });
 }
 async assertIntegrity(wallet,attempts){
  await this.assertUnlocked(wallet);const markers=await attempts.attempts.list(wallet),holds=await this.holdings(wallet),bindings=(await this.chains.list(wallet)).map(r=>this.checkedBinding(r));
  for(const marker of markers){const kind=attempts.checkedMarker(marker).authority;if(kind==='private-proof'){const held=holds.find(h=>h.request.fingerprint===marker.request.fingerprint);if(!held||!isDeepStrictEqual(held.request,marker.request))throw Error(missing);}else if(kind==='transaction'&&privateTransaction(marker.request)){if(marker.request.version!==29||!bindings.some(b=>isDeepStrictEqual(b.chain,marker.request)))throw Error(missing);}}
  for(const held of holds)if(!markers.some(r=>attempts.checkedMarker(r).authority==='private-proof'&&isDeepStrictEqual(r.request,held.request)))throw Error(missing);
  for(const binding of bindings)if(!holds.some(h=>isDeepStrictEqual(h.request,binding.proof))||!markers.some(r=>attempts.checkedMarker(r).authority==='transaction'&&isDeepStrictEqual(r.request,binding.chain)))throw Error(missing);
 }
 async assertSigningHistory(wallet,attempts,request,authority){
  if(authority!=='private-proof'&&!(authority==='transaction'&&privateTransaction(request)))return;
  // Imported authorizations remain usable for public finalization/recovery,
  // but a key-bearing device must restore its authoritative note state first.
  const proofs=attempts.primary['private-proof']?await attempts.primary['private-proof'].list(wallet):[];
  for(const record of proofs){const held=await this.claims.load(wallet,record.request.fingerprint.slice(2));if(!held||!isDeepStrictEqual(this.checkedClaim(held).request,record.request))throw Error(missing);}
  const transactions=attempts.primary.transaction?await attempts.primary.transaction.list(wallet):[];
  for(const record of transactions.filter(r=>privateTransaction(r.request))){if(record.request.version!==29)throw Error(missing);const proof=record.request.package.request,held=await this.claims.load(wallet,proof.fingerprint.slice(2)),bound=await this.chains.load(wallet,proof.fingerprint.slice(2));if(!held||!isDeepStrictEqual(this.checkedClaim(held).request,proof)||!bound||!isDeepStrictEqual(this.checkedBinding(bound).chain,record.request))throw Error(missing);}
 }
}
module.exports={PrivateNoteClaims};
