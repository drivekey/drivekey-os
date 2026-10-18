// Negative evidence-binding checks on local copies, never the successful record.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const original=path.resolve(process.argv[2]),verifier=path.resolve(process.argv[3]);
const originalBytes=readFileSync(path.join(original,'result.json'));const base=JSON.parse(originalBytes);assert.equal(base.success,true);
const accepted=JSON.parse(readFileSync(path.join(original,'native-transfer-verification.json')));assert.equal(accepted.success,true);assert.equal(accepted.harnessResultSha256,createHash('sha256').update(originalBytes).digest('hex'));
const temporary=mkdtempSync(path.join(path.dirname(original),'native-binding-negative-'));
const checks=[];
for(const field of ['requestSha256','publicWalletSha256','sourceImageSha256']){
 const dir=path.join(temporary,field);mkdirSync(path.join(dir,'wallet-output'),{recursive:true});
 for(const name of ['wallet-public.json','unsigned-request.json','signed-response.json'])copyFileSync(path.join(original,'wallet-output',name),path.join(dir,'wallet-output',name));
 const altered=structuredClone(base);altered.syntheticTransferInput[field]='f'.repeat(64);assert.notEqual(altered.syntheticTransferInput[field],base.syntheticTransferInput[field]);
 writeFileSync(path.join(dir,'result.json'),JSON.stringify(altered));
 const result=spawnSync(process.execPath,[verifier,dir],{encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(result.status,1);assert.match(result.stderr,/Guest native transfer verification failed/);checks.push({changedOriginalBinding:field,rejected:true});
}
assert.deepEqual(readFileSync(path.join(original,'result.json')),originalBytes);
const report={kind:'native-transfer-original-binding-negative-tests',checks,success:true,successfulRecordUnchanged:true,harnessResultSha256:createHash('sha256').update(originalBytes).digest('hex'),verifierSha256:createHash('sha256').update(readFileSync(verifier)).digest('hex'),localCopiesExcludedFromRelease:true};
writeFileSync(path.join(original,'native-transfer-binding-negative-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
