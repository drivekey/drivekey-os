'use strict';
// Explicit, separately packaged, unfunded offline test profile. Never enabled by
// environment, a renderer flag, a credential filename, or a normal release.
const fs=require('node:fs'),path=require('node:path');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOTICE='Unfunded offline fixture qualification only. This operation is disabled.';
const CHANNELS=new Set(['application-mode','interface-settings','set-interface-zoom','list-wallets','load-vault','activate-wallet','clear-session','export-public','export-backup','verify-backup','import-request','sign-request','list-signatures','export-signature','list-updates']);
function fixtureFromPackage(metadata){
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('Invalid application metadata.');
 if(!Object.hasOwn(metadata,'drivekeyFixtureSigning'))return null;
 const p=metadata.drivekeyFixtureSigning;
 if(metadata.drivekeyQualification!==undefined||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='baseSourceFingerprint,mode,profileId,version'||p.version!==1||p.mode!=='unfunded-local-solana'||!UUID.test(p.profileId)||typeof p.baseSourceFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(p.baseSourceFingerprint))throw Error('Invalid offline fixture qualification metadata.');
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
function assertFixtureChannel(channel){if(!CHANNELS.has(channel))throw Error(NOTICE);}
function assertFixtureRequest(request){if(request?.version!==8||request.action!=='payment'||request.chain!=='solana'||request.network!=='solana'||!['SOL','USDC'].includes(request.asset))throw Error(NOTICE);}
module.exports={fixtureFromPackage,configureFixtureProfile,fixturePassword,assertFixtureChannel,assertFixtureRequest,NOTICE};
