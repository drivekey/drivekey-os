// Exact guest-output cryptographic acceptance only; never submits a transaction.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyMultiResponse} from '../core/multi-protocol';
import {verifyTradeResponse} from '../core/trade-protocol';
import {rehearseMultichainOnline} from './rehearse-interactive-multichain-online';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const root=path.resolve(process.argv[2]),reportBytes=readFileSync(path.join(root,'result.json')),report=JSON.parse(reportBytes.toString());
 assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
 const fixture=report.syntheticTransferInput;assert.equal(fixture.kind,'unfunded-qmp-multichain-fixtures');assert.equal(fixture.sourceImageSha256,report.sourceSha256);assert.equal(fixture.network,false);assert.equal(fixture.externalRPCRequests,0);assert.equal(fixture.realFunds,0);
 const digests:Record<string,string>={};function read(name:string){const raw=readFileSync(path.join(root,'wallet-output',name));digests[name]=hash(raw);assert.equal(digests[name],report.outputFiles.find((x:any)=>x.name===name)?.sha256);return JSON.parse(raw.toString());}
 const wallet=read('wallet-multi-public.json');assert.equal(digests['wallet-multi-public.json'],fixture.publicWalletSha256);
 const checks=[];
 for(const [requestName,responseName,kind] of [['unsigned-multi-request.json','signed-multi-response.json','solana-native'],['unsigned-trade-request.json','signed-trade-response.json','ethereum-native']]as const){
  const request=read(requestName),response=read(responseName);assert.equal(digests[requestName],fixture.requests[requestName].sha256);assert.equal(request.fingerprint,fixture.requests[requestName].fingerprint);
  if(kind==='solana-native'){assert.equal(request.network,'solana');assert.equal(request.standard,'native');verifyMultiResponse(response,request,wallet);}
  else{assert.equal(request.network,'ethereum');assert.equal(request.chainId,1);assert.equal(request.kind,'payment');assert.equal(request.tokenIn,'ETH');verifyTradeResponse(response,request,wallet);}
  const online=await rehearseMultichainOnline(kind,wallet,request,response);
  checks.push({kind,online,originalRequestBound:true,signatureAndExactReviewedBytes:true,signerAndApprovalContext:true,transactionHash:response.transactionHash,requestFingerprint:request.fingerprint});
 }
 writeFileSync(path.join(root,'multichain-transfer-verification.json'),JSON.stringify({kind:'exact-guest-multichain-signature-verification',sourceImageSha256:report.sourceSha256,harnessResultSha256:hash(reportBytes),fileDigests:digests,checks,externalRPCRequests:0,realFunds:0,actualChainSettlement:false,fundingReady:false,success:true},null,2)+'\n');console.log('Both guest signatures match original requests and public identity; no chain settlement.');
}
main().catch(()=>{console.error('Multichain output verification failed.');process.exitCode=1;});
