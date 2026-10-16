/** Host-side cryptographic check of recorded disposable QMP wallet outputs.
 * Bundle with esbuild for Node. Pass only the disposable passphrase on stdin.
 * No signing, network, production wallet or broadcast functionality.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {checkOfflineVaultPassword} from '../offline-signer/vault';
import {unlockMultiVault} from '../offline-signer/multi-vault';

async function main(){
 const directory=path.resolve(process.argv[2]??'');
 const report=JSON.parse(readFileSync(path.join(directory,'result.json'),'utf8'));
 assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.fundingReady,false);assert.equal(report.network,false);
 assert.ok(report.fatEntries.every((name:string)=>name==='::/DriveKey/'||/^::\/DriveKey\/(vault-(?:multi-)?(?:encrypted|backup)|wallet-(?:multi-)?public|unsigned-request|signed-response)\.json$/.test(name)),'Unexpected transaction/output file');
 const phrase=readFileSync(0,'utf8').replace(/\r?\n$/,'');assert.ok(phrase.length>=12&&phrase.length<=256);
 const files=new Map<string,unknown>();
 for(const item of report.outputFiles){
  if(['unsigned-request.json','signed-response.json'].includes(item.name))continue;
  assert.match(item.name,/^(vault-(?:multi-)?(?:encrypted|backup)|wallet-(?:multi-)?public)\.json$/);
  const raw=readFileSync(path.join(directory,'wallet-output',item.name));assert.equal(createHash('sha256').update(raw).digest('hex'),item.sha256);files.set(item.name,JSON.parse(raw.toString()));
 }
 const checks=[];
 for(const [profile,vaultName,publicName,backupName] of [['v2','vault-encrypted.json','wallet-public.json','vault-backup.json'],['v3','vault-multi-encrypted.json','wallet-multi-public.json','vault-multi-backup.json']]){
  if(!files.has(vaultName))continue;
  const vault=files.get(vaultName) as any;assert.deepEqual(files.get(publicName),vault.public);assert.deepEqual(files.get(backupName),vault);
  if(profile==='v2'){
   assert.equal(await checkOfflineVaultPassword(vault,phrase),vault.public.address);
   await assert.rejects(checkOfflineVaultPassword(vault,phrase+'-wrong'));
  }else{
   const keys=await unlockMultiVault(vault,phrase);assert.equal(keys.evm.address,vault.public.evmAddress);assert.equal(keys.sol.publicKey.toBase58(),vault.public.solanaAddress);
   await assert.rejects(unlockMultiVault(vault,phrase+'-wrong'));
  }
  checks.push({profile,encryptedVaultUnlocks:true,publicExportMatches:true,backupMatchesExactly:true,wrongPasswordRejected:true});
 }
 assert.ok(checks.length>0,'No generated wallet output verified');
 const previous=process.argv[3];
 if(previous){
  const old=JSON.parse(readFileSync(path.resolve(previous,'result.json'),'utf8'));assert.equal(old.sourceSha256,report.sourceSha256);
  for(const item of report.outputFiles){if(item.name.includes('encrypted')||item.name.includes('public'))assert.equal(item.sha256,old.outputFiles.find((x:any)=>x.name===item.name)?.sha256,'Restored identity/encrypted bytes changed');}
 }
 const result={kind:'disposable-interactive-wallet-output-verification',sourceImageSha256:report.sourceSha256,harnessResultSha256:createHash('sha256').update(readFileSync(path.join(directory,'result.json'))).digest('hex'),checks,restoredOutputsMatchPrior:!!previous,noSignedResponseObserved:!report.outputFiles.some((x:any)=>x.name==='signed-response.json'),networkAbsent:true,fundingReady:false,success:true};
 writeFileSync(path.join(directory,'wallet-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Disposable output verification failed; no readiness claim.');process.exitCode=1;});
