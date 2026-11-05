'use strict';
// Fresh synthetic note, genuine EdDSA and wallet crypto; no provider or RPC.
// These delays affect test builds only and advance actual elapsed wall time.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),sourceRoot=process.env.DRIVEKEY_DEADLINE_SOURCE?path.resolve(process.env.DRIVEKEY_DEADLINE_SOURCE):root,hook=Symbol.for('DriveKey test proof key delivery');
const sdk=require('../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs'),OriginalUserKeys=sdk.UserKeys;
let api,f,active;
const waitUntil=async deadline=>{while(Date.now()<=deadline)await new Promise(resolve=>setTimeout(resolve,Math.min(50,deadline-Date.now()+1)));};
before(async()=>{
 const directory=await fs.mkdtemp(path.join(root,'verification/proof-deadline-'));
 const result=await esbuild.build({stdin:{contents:"export * from './tests/helpers/hinkal-product-proof-fixture';export * from './engine/offline-signer/hinkal-product-proof';export * from './engine/core/hinkal-product-proof';export * from './engine/offline-signer/private-note-manifest';",resolveDir:sourceRoot,loader:'ts'},bundle:true,packages:'external',platform:'node',format:'cjs',write:false,
  plugins:[{name:'real-crypto-delivery-delays',setup(build){
   build.onResolve({filter:/node_modules\/@hinkal\//},args=>({path:path.resolve(args.resolveDir,args.path),external:true}));
   build.onResolve({filter:/^\.\/multi-vault$/},args=>args.importer.includes('offline-signer')?{path:'delayed-unlock',namespace:'proof-deadline-test'}:undefined);
   build.onLoad({filter:/.*/,namespace:'proof-deadline-test'},()=>({contents:`import {unlockMultiVault as actual} from ${JSON.stringify(path.join(sourceRoot,'engine/offline-signer/multi-vault.ts'))};export async function unlockMultiVault(...args){const keys=await actual(...args);return globalThis[Symbol.for('DriveKey test proof key delivery')](keys);}`,resolveDir:sourceRoot,loader:'ts'}));
  }}]});
 // SDK signEddsa is an instance field, so preserve its actual implementation
 // in a test-only subclass rather than replacing an unused prototype method.
 sdk.UserKeys=class extends OriginalUserKeys{constructor(...args){super(...args);const actual=this.signEddsa.bind(this);this.signEddsa=(...values)=>{
  const signature=actual(...values);if(!active)return signature;active.authorizations++;active.signature={R8:signature.R8.map(String),S:signature.S.toString()};
  if(active.mode==='circuit')while(Date.now()<=active.deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(50,active.deadline-Date.now()+1));return signature;
 };}};
 const file=path.join(directory,'signer.cjs');await fs.writeFile(file,result.outputFiles[0].contents);api=require(file);f=await api.productProofFixture();
 globalThis[hook]=async keys=>{
  active.unlocks++;const approve=keys.evm.signMessage.bind(keys.evm);
  keys.evm.signMessage=async message=>{const signature=await approve(message);if(active.mode==='wallet'&&String(message).startsWith('DriveKey product private-proof response')||active.mode==='note-inspection'&&message===require('../dist/hinkal.cjs').HINKAL_PIN.sdkLoginMessage)await waitUntil(active.deadline);return signature;};
  if(active.mode==='inner-unlock'&&active.unlocks===2)await waitUntil(active.deadline);
  return keys;
 };
});
after(()=>{delete globalThis[hook];sdk.UserKeys=OriginalUserKeys;f=undefined;});
function request(mode){const r=structuredClone(f.request);r.expiresAt=new Date(Date.now()+5000).toISOString();r.fingerprint=api.productProofFingerprint(r);active={mode,deadline:Date.parse(r.expiresAt)+20,unlocks:0,authorizations:0};return r;}
for(const mode of ['circuit','wallet'])test(`retains original product authorization after delayed ${mode} completion crosses the outer deadline`,async()=>{
 const r=request(mode),s=await api.authorizeProductProof(f.vault,f.password,r,r.fingerprint);
 assert.ok(Date.now()>Date.parse(r.expiresAt));assert.equal(active.authorizations,1);assert.deepEqual(s.proofAuthorization.authorization,active.signature);
 assert.ok(Date.parse(s.signedAt)<Date.parse(r.expiresAt));assert.equal(s.signedAt,s.proofAuthorization.signedAt);
 assert.deepEqual(await api.verifyProductProofResponse(r,s,Date.now(),false),s);
 await assert.rejects(api.verifyProductProofResponse(r,s));await assert.rejects(api.authorizeProductProof(f.vault,f.password,r,r.fingerprint));assert.equal(active.authorizations,1);
});
test('original outer expiry is enforced at the circuit boundary even while the inner seed remains current',async()=>{
 const r=request('inner-unlock');assert.ok(Date.parse(r.seed.expiresAt)>active.deadline);
 await assert.rejects(api.authorizeProductProof(f.vault,f.password,r,r.fingerprint),/lifetime|scope|expired/);assert.equal(active.authorizations,0);
});
test('private note inspection crossing the original deadline returns no manifest or circuit authorization',async()=>{
 const r=request('note-inspection');await assert.rejects(api.inspectProductNotes(f.vault,f.password,r),/expired|lifetime|scope/);assert.equal(active.authorizations,0);assert.equal(active.unlocks,1);
});
