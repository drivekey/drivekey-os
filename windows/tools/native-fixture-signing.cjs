'use strict';
// Explicit, separately packaged, unfunded offline test profile. Never enabled by
// environment, a renderer flag, a credential filename, or a normal release.
const fs=require('node:fs'),path=require('node:path');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOTICE='Unfunded offline fixture qualification only. This operation is disabled.';
const CHANNELS=new Set(['application-mode','interface-settings','set-interface-zoom','list-wallets','load-vault','activate-wallet','clear-session','export-public','export-backup','verify-backup','import-request','sign-request','list-signatures','export-signature','list-updates']);
const SCOPED_MODE='unfunded-scoped-offline';
const PRIVATE_CHANNELS=new Set(['import-private-view-request','authorize-private-view','export-private-view-request','export-private-view-response','import-product-proof','review-product-proof','sign-product-proof','list-product-proofs','export-product-proof','prove-product-proof','export-product-proof-result','recover-signing-response','inspect-note-history','cancel-note-discovery','note-discovery-progress','list-note-discoveries','export-note-discovery','export-private-note-selection','list-private-note-selections','export-saved-private-note-selection','cancel-private-note-selection']);
const scoped=metadata=>metadata?.version===2&&metadata.mode===SCOPED_MODE;
function fixtureFromPackage(metadata){
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('Invalid application metadata.');
 if(!Object.hasOwn(metadata,'drivekeyFixtureSigning'))return null;
 const p=metadata.drivekeyFixtureSigning;
 if(metadata.drivekeyQualification!==undefined||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='baseSourceFingerprint,mode,profileId,version'||!(p.version===1&&p.mode==='unfunded-local-solana'||scoped(p))||!UUID.test(p.profileId)||typeof p.baseSourceFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(p.baseSourceFingerprint))throw Error('Invalid offline fixture qualification metadata.');
 return Object.freeze({...p});
}
function configureFixtureProfile(app,metadata,offline){
 const p=fixtureFromPackage({drivekeyFixtureSigning:metadata});if(offline!==true)throw Error(NOTICE);
 const base=fs.realpathSync(app.getPath('appData')),namespace=path.join(base,'DriveKey Offline Fixture Qualification'),profile=path.join(namespace,p.profileId);
 for(const directory of [namespace,profile]){try{fs.mkdirSync(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Redirected offline fixture profile.');}
 app.setName('DriveKey Offline Fixture Qualification');app.setPath('userData',profile);app.setPath('sessionData',profile);return profile;
}
function fixturePassword(value,metadata){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='fixtureProfileId'||value.fixtureProfileId!==metadata.profileId)throw Error('Use the protected local fixture credential reference.');
 return Object.freeze({fixtureProfileId:metadata.profileId});
}
function assertFixtureChannel(channel,metadata){if(!CHANNELS.has(channel)&&!(scoped(metadata)&&PRIVATE_CHANNELS.has(channel)))throw Error(NOTICE);}
function assertFixtureRequest(request,metadata){
 if(!scoped(metadata)){if(request?.version!==8||request.action!=='payment'||request.chain!=='solana'||request.network!=='solana'||!['SOL','USDC'].includes(request.asset))throw Error(NOTICE);return;}
 const chains={8:null,9:'ethereum',10:'ethereum',11:'solana',12:'ethereum',14:'solana',16:'solana',18:'ethereum',21:'solana',22:'ethereum',23:'solana',24:'ethereum',25:'solana',26:'ethereum',29:null};
 // V29 is a strict product envelope: its network belongs to the enclosed
 // transaction. The original dispatcher still verifies the complete envelope.
 const transaction=request?.version===29?request.chainRequest:request;
 if(!Object.hasOwn(chains,request?.version)||!['ethereum','solana'].includes(request.chain)||transaction?.chain!==request.chain||transaction.network!==request.chain||chains[request.version]&&chains[request.version]!==request.chain)throw Error(NOTICE);
 if(request.version===8&&(request.action!=='payment'||!['USDC',request.chain==='ethereum'?'ETH':'SOL'].includes(request.asset)))throw Error(NOTICE);
}
function fixturePolicy(base,metadata){
 if(!scoped(metadata))return base;
 // Review orchestration only. The sole broker separately matches each job to
 // its protected exact scope before running the original compiled dispatcher.
 return Object.freeze({...base,assertIpcChannel:channel=>assertFixtureChannel(channel,metadata),assertIntent:request=>assertFixtureRequest(request,metadata),allowedIntent:request=>{try{assertFixtureRequest(request,metadata);return true;}catch{return false;}},assertPrivateView:request=>{if(request!==undefined&&request.version!==30)throw Error(NOTICE);},assertProductProof:request=>{if(request!==undefined&&request.version!==28)throw Error(NOTICE);}});
}
function fixtureWorkerJob(metadata,input,worker){if(!metadata)return false;if(!scoped(metadata))return worker==='worker.cjs'&&['verify','sign'].includes(input?.action);return !!input?.vault&&(worker==='worker.cjs'&&['verify','review','sign','review-private-view','authorize-private-view','review-product-proof','inspect-public-notes','inspect-product-notes','sign-product-proof'].includes(input.action)||worker==='product-proof-worker.cjs'&&input.action==='prove-product-proof');}
module.exports={fixtureFromPackage,configureFixtureProfile,fixturePassword,assertFixtureChannel,assertFixtureRequest,fixturePolicy,fixtureWorkerJob,scoped,NOTICE};
