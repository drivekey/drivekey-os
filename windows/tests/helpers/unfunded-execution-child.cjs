'use strict';
require('../offline-network-deny.cjs');
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {createProfile,directory,persist,loadEnrollment}=require('./unfunded-execution-profile.cjs');
const {exactFixturePolicy,digest}=require('./unfunded-execution-policy.cjs');
const root=path.resolve(__dirname,'../..'),manifest=require('../../BUILD-MANIFEST.json');
let size=0,chunks=[];
process.stdin.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){chunk.fill(0);process.exit(2);}chunks.push(chunk);});
process.stdin.on('end',async()=>{
  let job;
  try {
    const raw=Buffer.concat(chunks);chunks.forEach(b=>b.fill(0));chunks=[];let envelope;try{envelope=JSON.parse(raw);}finally{raw.fill(0);}
    job=envelope.job;
    const source=await import('../../tools/fingerprint.mjs').then(m=>m.fingerprint(root));
    if(source.fingerprint!==manifest.sourceFingerprint||createHash('sha256').update(fs.readFileSync(path.join(root,'dist/worker.cjs'))).digest('hex')!==manifest.binaryHashes['worker.cjs'])throw Error('Fixture build changed.');
    if(!['create','review','sign','verify-saved'].includes(job?.action))throw Error('Unsupported fixture action.');
    let profile;
    if(job.action==='create'){if(envelope.profileId||job.vault)throw Error('Only fresh fixture creation is permitted.');profile=createProfile();}
    else {
      const enrollment=loadEnrollment(envelope.profileId);
      if(enrollment.kind!=='fresh-unfunded-vault'||enrollment.sourceFingerprint!==source.fingerprint||digest(job.vault)!==enrollment.vaultHash)throw Error('Only an enrolled fresh unfunded fixture vault is permitted.');
      profile={id:envelope.profileId,directory:directory(envelope.profileId)};
    }
    const record=randomUUID();persist(profile,record+'-job.dpapi',job);
    const {executeOfflineJob}=require('../../dist/worker.cjs');
    const policy=['review','sign'].includes(job.action)?exactFixturePolicy(job.request,job.vault.public,{sourceFingerprint:source.fingerprint}):undefined;
    const result=await executeOfflineJob(job,policy);
    persist(profile,record+'-result.dpapi',result);
    if(job.action==='create')persist(profile,'enrollment.dpapi',{kind:'fresh-unfunded-vault',sourceFingerprint:source.fingerprint,vaultHash:digest(result)});
    process.stdout.write(JSON.stringify({ok:true,result,profileId:profile.id}),()=>process.exit(0));
  } catch {if(job)job.password=undefined;process.stdout.write(JSON.stringify({ok:false,error:'Local signer rejected the unfunded fixture operation.'}),()=>process.exit(1));}
});
