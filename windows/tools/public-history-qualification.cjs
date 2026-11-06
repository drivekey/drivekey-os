'use strict';
// Build metadata only. No environment variable or renderer input enables this.
const path=require('node:path'),fs=require('node:fs');
const MODE='public-history-read-only',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function qualificationFromPackage(metadata){
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('Invalid application metadata.');
 if(!Object.hasOwn(metadata,'drivekeyQualification'))return null;
 const p=metadata.drivekeyQualification;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='baseSourceFingerprint,mode,profileId,version'||p.version!==1||p.mode!==MODE||!UUID.test(p.profileId)||typeof p.baseSourceFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(p.baseSourceFingerprint))throw Error('Invalid public-history qualification build metadata.');
 return Object.freeze({...p});
}
function qualificationProfilePath(metadata,appData,offline=false){
 const p=qualificationFromPackage({drivekeyQualification:metadata});
 if(typeof appData!=='string'||!path.isAbsolute(appData))throw Error('Qualification profile requires an absolute application-data directory.');
 if(typeof offline!=='boolean')throw Error('Invalid qualification mode.');
 return path.join(path.resolve(appData),'DriveKey Public History Qualification',p.profileId,offline?'offline':'online');
}
function configureQualificationProfile(app,metadata,offline=false){
 const profile=qualificationProfilePath(metadata,fs.realpathSync(app.getPath('appData')),offline),scope=path.dirname(profile),namespace=path.dirname(scope);
 for(const directory of [namespace,scope,profile]){try{fs.mkdirSync(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Redirected public-history qualification profile.');}
 app.setName('DriveKey Public History Qualification');app.setPath('userData',profile);app.setPath('sessionData',profile);
 return profile;
}
module.exports={qualificationFromPackage,qualificationProfilePath,configureQualificationProfile};
