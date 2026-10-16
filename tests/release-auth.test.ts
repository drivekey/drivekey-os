import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {releaseSigningBytes,verifyReleaseCandidate} from '../core/release-auth';
const keys=Array.from({length:3},()=>generateKeyPairSync('ed25519'));
const now=Date.parse('2026-10-11T12:00:00Z');
const manifest={kind:'drivekey-authenticated-release',version:1,product:'drivekey-hardware',hardwareRevision:'prototype-a',channel:'candidate',releaseVersion:'0.1.0',sequence:2,minimumBootVersion:1,payloadBytes:10,payloadSha256:'12'.repeat(32),sourceSha256:'34'.repeat(32),createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString()};
const trust={product:'drivekey-hardware',hardwareRevision:'prototype-a',allowProduction:false,keys:keys.map((k,i)=>({keyId:'release-'+i,publicKeyPem:k.publicKey.export({type:'spki',format:'pem'}).toString()}))};
const approvals=keys.slice(0,2).map((k,i)=>({keyId:'release-'+i,signature:sign(null,releaseSigningBytes(manifest),k.privateKey).toString('base64')}));
const bundle={manifest,approvals},state={installedSequence:1,bootVersion:1},artifact={sha256:manifest.payloadSha256,bytes:10};
function signedManifest(patch:Partial<typeof manifest>){
 const next={...manifest,...patch};
 return {manifest:next,approvals:keys.slice(0,2).map((k,i)=>({keyId:'release-'+i,signature:sign(null,releaseSigningBytes(next),k.privateKey).toString('base64')}))};
}
describe('authenticated release candidate gates',()=>{
 it('requires two independent trusted signatures and never authorizes installation',()=>{
  expect(verifyReleaseCandidate(bundle,trust,state,artifact,now)).toMatchObject({status:'candidate-authenticated',installationAuthorized:false});
  for(const ap of [approvals.slice(0,1),[approvals[0],approvals[0]],[approvals[0],{...approvals[1],keyId:'unknown'}]])expect(()=>verifyReleaseCandidate({...bundle,approvals:ap},trust,state,artifact,now)).toThrow();
 });
 it('rejects manifest substitution, wrong model and artifact tampering',()=>{
  for(const patch of [{hardwareRevision:'other'},{product:'drivekey-offline'},{sourceSha256:'56'.repeat(32)},{releaseVersion:'0.2.0'},{sequence:3},{payloadBytes:11}])expect(()=>verifyReleaseCandidate({...bundle,manifest:{...manifest,...patch}},trust,state,artifact,now)).toThrow();
  expect(()=>verifyReleaseCandidate(bundle,trust,state,{...artifact,sha256:'00'.repeat(32)},now)).toThrow();
 });
 it('rejects rollback, expiry, newer required boot and production candidates',()=>{
  expect(()=>verifyReleaseCandidate(bundle,trust,{...state,installedSequence:2},artifact,now)).toThrow();
  expect(()=>verifyReleaseCandidate(bundle,trust,{...state,bootVersion:0},artifact,now)).toThrow();
  expect(()=>verifyReleaseCandidate(bundle,trust,state,artifact,now+86400000)).toThrow();
  expect(()=>verifyReleaseCandidate({...bundle,manifest:{...manifest,channel:'production'}},trust,state,artifact,now)).toThrow();
 });
 it('rejects duplicate trust keys, unsupported schemas and invalid clocks',()=>{
  expect(()=>verifyReleaseCandidate(bundle,{...trust,keys:[trust.keys[0],{...trust.keys[0],keyId:'release-1'},trust.keys[2]]},state,artifact,now)).toThrow();
  expect(()=>verifyReleaseCandidate({...bundle,adminOverride:true},trust,state,artifact,now)).toThrow();
  expect(()=>verifyReleaseCandidate(bundle,trust,state,artifact,NaN)).toThrow();
 });
 it('enforces lifetime boundaries even when both release keys approve the metadata',()=>{
  const atStart=signedManifest({createdAt:new Date(now).toISOString(),expiresAt:new Date(now+90*86400000).toISOString()});
  expect(verifyReleaseCandidate(atStart,trust,state,artifact,now).installationAuthorized).toBe(false);
  expect(verifyReleaseCandidate(atStart,trust,state,artifact,now+90*86400000-1).installationAuthorized).toBe(false);
  expect(()=>verifyReleaseCandidate(atStart,trust,state,artifact,now+90*86400000)).toThrow(/expired or invalid/);
  for(const patch of [
   {createdAt:new Date(now+1).toISOString()},
   {createdAt:new Date(now).toISOString(),expiresAt:new Date(now).toISOString()},
   {createdAt:new Date(now).toISOString(),expiresAt:new Date(now+90*86400000+1).toISOString()},
  ])expect(()=>verifyReleaseCandidate(signedManifest(patch),trust,state,artifact,now)).toThrow(/expired or invalid/);
 });
 it('enforces the boot floor and monotonic release sequence despite a valid quorum',()=>{
  expect(()=>verifyReleaseCandidate(signedManifest({minimumBootVersion:2}),trust,state,artifact,now)).toThrow(/Rollback or incompatible/);
  expect(()=>verifyReleaseCandidate(signedManifest({sequence:1}),trust,state,artifact,now)).toThrow(/Rollback or incompatible/);
  expect(verifyReleaseCandidate(signedManifest({minimumBootVersion:2,sequence:3}),trust,{installedSequence:2,bootVersion:2},artifact,now).sequence).toBe(3);
 });
});
