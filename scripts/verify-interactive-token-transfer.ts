// Exact guest token signature acceptance; no transport or secret handling.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyMultiResponse} from '../core/multi-protocol';
const root=path.resolve(process.argv[2]),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(path.join(root,'result.json')),report=JSON.parse(bytes.toString());assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
const fixture=report.syntheticTransferInput;assert.equal(fixture.kind,'unfunded-qmp-token-fixture');assert.equal(fixture.sourceImageSha256,report.sourceSha256);assert.equal(fixture.network,false);assert.equal(fixture.realFunds,0);assert.equal(fixture.externalRPCRequests,0);
const digests:Record<string,string>={};function read(name:string){const raw=readFileSync(path.join(root,'wallet-output',name));digests[name]=hash(raw);assert.equal(digests[name],report.outputFiles.find((x:any)=>x.name===name)?.sha256);return JSON.parse(raw.toString());}
const wallet=read('wallet-multi-public.json'),request=read('unsigned-multi-request.json'),response=read('signed-multi-response.json');assert.equal(digests['wallet-multi-public.json'],fixture.publicWalletSha256);assert.equal(digests['unsigned-multi-request.json'],fixture.requests['unsigned-multi-request.json'].sha256);assert.equal(request.fingerprint,fixture.requests['unsigned-multi-request.json'].fingerprint);assert.equal(request.network,'solana');assert.equal(request.standard,'spl');assert.equal(request.createRecipientAccount,true);verifyMultiResponse(response,request,wallet);
writeFileSync(path.join(root,'token-signature-verification.json'),JSON.stringify({kind:'exact-guest-spl-signature-verification',sourceImageSha256:report.sourceSha256,harnessResultSha256:hash(bytes),fileDigests:digests,originalRequestBound:true,signatureAndExactReviewedBytes:true,transactionHash:response.transactionHash,requestFingerprint:request.fingerprint,externalRPCRequests:0,realFunds:0,actualChainSettlement:false,fundingReady:false,success:true},null,2)+'\n');console.log('Exact guest classic SPL signature verified; no chain settlement.');
