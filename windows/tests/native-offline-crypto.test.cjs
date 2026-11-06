'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),helper=path.join(__dirname,'helpers/native-offline-fixture.cjs'),broker=path.join(root,'tools/native-fixture-worker.cjs'),worker=path.join(root,'dist/worker.cjs'),prover=path.join(root,'dist/product-proof-worker.cjs'),{dpapi,checkedCredential}=require('../tools/native-fixture-worker.cjs');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function call(file,args,input){const run=spawnSync(process.execPath,['--no-addons',file,...args],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2*1024*1024,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,LOCALAPPDATA:process.env.LOCALAPPDATA,TEMP:process.env.TEMP,TMP:process.env.TMP}});let reply;try{reply=JSON.parse(run.stdout);}catch{throw Error('Bounded native fixture child returned no response.');}if(run.status||!reply.ok)throw Error('Native fixture child rejected phase '+(reply.phase||'broker')+'.');return reply.result;}
async function preserve(directory,value){const plain=Buffer.from(JSON.stringify(value));let cipher;try{cipher=await dpapi('Protect',plain);const h=await fs.open(path.join(directory,'crypto-result-'+randomUUID()+'.dpapi'),'wx',0o600);try{await h.writeFile(cipher);await h.sync();}finally{await h.close();}}finally{plain.fill(0);cipher?.fill(0);}}
const invoke=(profile,job,file=worker)=>call(broker,[file],{metadata:profile.metadata,input:job});
async function fixture(kind,artifactDirectory){const profile=call(helper,[],{action:'create',kind}),prepared=call(helper,[],{action:'prepare',profileId:profile.profileId,...artifactDirectory?{artifactDirectory}:{}}),vault=JSON.parse(await fs.readFile(profile.vaultFile));return {profile,prepared,vault,password:{fixtureProfileId:profile.profileId}};}
test('the exact protected broker reviews signs and recovers five fresh-unfunded canonical payment requests',async()=>{
 const f=await fixture('payments');assert.equal(f.prepared.cases.length,5);
 for(const item of f.prepared.cases){const request=JSON.parse(await fs.readFile(item.requestFile)),review=invoke(f.profile,{action:'review',vault:f.vault,request});assert.equal(review.fingerprint,request.fingerprint);
  const response=invoke(f.profile,{action:'sign',vault:f.vault,password:f.password,request,fingerprint:request.fingerprint});await preserve(f.profile.directory,{request,response});
  const recovered=call(worker,[],{action:'verify-saved',vault:f.vault,request,response});assert.equal(sha(recovered.response),sha(response));
  const {verifyPaymentResponse}=require('../dist/payment.cjs');assert.equal(verifyPaymentResponse(response,request,f.vault.public).transactionHash,response.transactionHash);
 }
});
test('the exact protected broker signs both Uniswap directions and only bounded approval or zero revocation',async()=>{
 const f=await fixture('uniswap');assert.equal(f.prepared.cases.length,4);
 for(const item of f.prepared.cases){const request=JSON.parse(await fs.readFile(item.requestFile)),review=invoke(f.profile,{action:'review',vault:f.vault,request});assert.equal(review.fingerprint,request.fingerprint);const response=invoke(f.profile,{action:'sign',vault:f.vault,password:f.password,request,fingerprint:request.fingerprint});await preserve(f.profile.directory,{request,response});assert.equal(require('../dist/swap.cjs').verifySwapResponse(response,request,f.vault.public).transactionHash,response.transactionHash);
  const changed=structuredClone(request);changed.recipient='0x'+'2'.repeat(40);assert.throws(()=>invoke(f.profile,{action:'sign',vault:f.vault,password:f.password,request:changed,fingerprint:request.fingerprint}),/rejected/);
 }
});
test('the exact protected broker creates and independently verifies genuine private proofs on both chains while refusing forged authorizations before unlock',async()=>{
 const artifacts=process.env.DRIVEKEY_HINKAL_ARTIFACTS;assert.ok(artifacts&&path.isAbsolute(artifacts),'The retained pinned proving artifacts are required.');
 for(const kind of ['private-ethereum','private-solana']){
  const f=await fixture(kind,artifacts),request=JSON.parse(await fs.readFile(f.prepared.cases[0].requestFile));
  const review=invoke(f.profile,{action:'review-product-proof',vault:f.vault,request});assert.equal(review.fingerprint,request.fingerprint);
  const manifest=invoke(f.profile,{action:'inspect-product-notes',vault:f.vault,password:f.password,request});assert.equal(manifest.fingerprint,f.prepared.privateManifestFingerprint);
  const response=invoke(f.profile,{action:'sign-product-proof',vault:f.vault,password:f.password,request,fingerprint:request.fingerprint,noteManifestFingerprint:manifest.fingerprint});await preserve(f.profile.directory,{request,response,manifest});
  const proofJob={action:'prove-product-proof',vault:f.vault,password:f.password,request,response,artifactDirectory:artifacts};
  const result=invoke(f.profile,proofJob,prover);await preserve(f.profile.directory,{request,response,result});await require('../dist/hinkal-product-result.cjs').verifyProductProofResult(request,response,result);assert.equal(result.blockchainTransactionSigned,false);assert.equal(result.submitted,false);
  let decryptions=0;const unprotect=async bytes=>{decryptions++;return dpapi('Unprotect',bytes);};const invalid=structuredClone(response);invalid.deviceId=randomUUID();
  await assert.rejects(checkedCredential({metadata:f.profile.metadata,input:{...proofJob,response:invalid}},{worker:prover,unprotect}));assert.equal(decryptions,1,'A forged authorization must not decrypt the unlock record.');
 }
});
