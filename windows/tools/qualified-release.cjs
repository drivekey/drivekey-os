'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
// Recovery remains possible after updates. New signatures/submissions require the
// exact source and every built artifact from the passing engineering snapshot.
async function qualifiedRelease(root){
 const source=await (await import('./fingerprint.mjs')).fingerprint(root),read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
 const checks=read('ENGINEERING-CHECKS.json'),build=read('BUILD-MANIFEST.json');
 if(!checks.passed||checks.failed!==0||checks.fingerprint!==source.fingerprint||build.sourceFingerprint!==source.fingerprint)throw Error('Current source, build and passing engineering checks must match.');
 if(!build.binaryHashes||Object.keys(build.binaryHashes).length<10)throw Error('Built artifact inventory missing.');
 for(const [name,hash]of Object.entries(build.binaryHashes)){
  if(!/^[a-zA-Z0-9.-]+\.(?:cjs|mjs)$/.test(name)||!/^[a-f0-9]{64}$/.test(hash)||createHash('sha256').update(fs.readFileSync(path.join(root,'dist',name))).digest('hex')!==hash)throw Error('Built artifact differs from qualified release.');
 }
 return {source,checks,build};
}
module.exports={qualifiedRelease};
