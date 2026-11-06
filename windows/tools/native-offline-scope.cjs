'use strict';
// Only explicitly packaged fresh-unfunded offline qualification uses this.
// It is never a release feature flag or a funded-signing authorization.
const {createHash}=require('node:crypto');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))??'undefined').digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const KEY_ACTIONS=new Set(['verify','sign','authorize-private-view','inspect-public-notes','inspect-product-notes','sign-product-proof']);
const REVIEW_ACTIONS=new Set(['review','review-private-view','review-product-proof']);
function knownJob(worker,input){return worker==='worker.cjs'?(KEY_ACTIONS.has(input?.action)||REVIEW_ACTIONS.has(input?.action)):worker==='product-proof-worker.cjs'&&input?.action==='prove-product-proof';}
function jobDigest(worker,input){
 if(!knownJob(worker,input))throw Error('Unsupported scoped offline job.');
 const value=structuredClone(input);delete value.password;
 // Native authorization is created after enrollment. The original prover
 // verifies this request's authorization BEFORE unlocking. No other field is
 // dynamic: request, vault, artifact directory and action remain fully bound.
 if(worker==='product-proof-worker.cjs')delete value.response;
 return digest({domain:'DriveKey fresh unfunded offline job v2',worker,input:value});
}
function validateScope(scope,metadata,input,worker,workerHash){
 if(!scope||Object.keys(scope).sort().join(',')!=='deviceId,fixtureOnly,jobs,kind,profileId,publicWalletDigest,sourceFingerprint,vaultDigest,version,workerHashes'||scope.version!==2||scope.kind!=='fresh-unfunded-offline-intent-scope'||scope.fixtureOnly!==true||scope.profileId!==metadata.profileId||scope.sourceFingerprint!==metadata.baseSourceFingerprint||scope.deviceId!==input.vault?.public?.deviceId||scope.vaultDigest!==digest(input.vault)||scope.publicWalletDigest!==digest(input.vault?.public)||!HASH.test(scope.sourceFingerprint)||!HASH.test(scope.vaultDigest)||!HASH.test(scope.publicWalletDigest))throw Error('Scoped offline profile differs.');
 if(!scope.workerHashes||typeof scope.workerHashes!=='object'||Array.isArray(scope.workerHashes)||!Object.keys(scope.workerHashes).length||Object.entries(scope.workerHashes).some(([name,hash])=>!['worker.cjs','product-proof-worker.cjs'].includes(name)||!HASH.test(hash))||scope.workerHashes[worker]!==workerHash)throw Error('Scoped offline worker differs.');
 if(!Array.isArray(scope.jobs)||scope.jobs.length<1||scope.jobs.length>32||scope.jobs.some(j=>!j||Object.keys(j).sort().join(',')!=='action,jobDigest,worker'||!knownJob(j.worker,{action:j.action})||!HASH.test(j.jobDigest))||new Set(scope.jobs.map(j=>j.worker+':'+j.action+':'+j.jobDigest)).size!==scope.jobs.length)throw Error('Invalid scoped offline job list.');
 if(!knownJob(worker,input)||!scope.jobs.some(j=>j.worker===worker&&j.action===input.action&&j.jobDigest===jobDigest(worker,input)))throw Error('This exact offline job was not enrolled.');
 if(input.wallet!==undefined&&digest(input.wallet)!==scope.publicWalletDigest)throw Error('Scoped offline wallet differs.');
 return scope;
}
function executionPolicy(input){
 const action=input.action,requestHash=digest(input.request),walletHash=digest(input.vault.public);let used=false;
 const expected=action==='review'||action==='sign'?'assertIntent':action==='authorize-private-view'||action==='inspect-public-notes'?'assertPrivateView':action==='inspect-product-notes'||action==='sign-product-proof'||action==='prove-product-proof'?'assertProductProof':null;
 const check=method=>(request,context)=>{if(method!==expected||used||digest(request)!==requestHash||context?.action!==action||digest(context.wallet)!==walletHash)throw Error('Scoped offline execution authority differs or was consumed.');used=true;};
 return Object.freeze({assertIntent:check('assertIntent'),assertPrivateView:check('assertPrivateView'),assertProductProof:check('assertProductProof')});
}
module.exports={digest,jobDigest,knownJob,validateScope,executionPolicy,keyBearing:(worker,input)=>worker==='product-proof-worker.cjs'||KEY_ACTIONS.has(input?.action)};
