/** Verify actual guest-signed bytes; rehearse online consent/submit/reconcile
 * against a purely in-memory synthetic RPC and claim store. No public network.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Transaction,toQuantity} from 'ethers';
import {verifyResponse,type Rpc} from '../core/protocol';
import {walletAction} from '../core/service';
import {walletSubmissionFixture} from '../tests/wallet-submission-fixture';
async function main(){
 const root=path.resolve(process.argv[2]);const harnessBytes=readFileSync(path.join(root,'result.json'));const report=JSON.parse(harnessBytes.toString());assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
 const fixture=report.syntheticTransferInput;assert.equal(fixture?.kind,'unfunded-qmp-native-transfer-fixture');assert.equal(fixture.sourceImageSha256,report.sourceSha256);assert.equal(fixture.network,false);assert.equal(fixture.externalRPCRequests,0);assert.equal(fixture.realFunds,0);assert.equal(fixture.chainId,4663);
 const digests:Record<string,string>={};
 const read=(name:string)=>{const bytes=readFileSync(path.join(root,'wallet-output',name));const digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digest,report.outputFiles.find((x:any)=>x.name===name)?.sha256);digests[name]=digest;return JSON.parse(bytes.toString());};
 const wallet=read('wallet-public.json'),request=read('unsigned-request.json'),response=read('signed-response.json');
 assert.equal(digests['unsigned-request.json'],fixture.requestSha256);assert.equal(digests['wallet-public.json'],fixture.publicWalletSha256);assert.equal(request.fingerprint,fixture.requestFingerprint);verifyResponse(response,request,wallet);
 const tx=Transaction.from(response.rawSignedTransaction);assert.equal(tx.unsignedSerialized,request.unsignedTransaction);assert.equal(tx.from,wallet.address);
 let sends=0,seen=false,receipted=false;const blockHash='0x'+'ab'.repeat(32);
 const actual={hash:tx.hash,from:tx.from,to:tx.to,input:tx.data,value:toQuantity(tx.value),nonce:toQuantity(tx.nonce),chainId:toQuantity(tx.chainId),type:toQuantity(tx.type!),gas:toQuantity(tx.gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!),accessList:tx.accessList,blockHash,blockNumber:'0x10'};
 const values:Record<string,unknown>={eth_call:'0x',eth_chainId:'0x1237',eth_getTransactionCount:'0x0',eth_estimateGas:'0x186a0',eth_maxPriorityFeePerGas:'0x0',eth_getCode:'0x',eth_getBalance:'0xde0b6b3a7640000'};
 const rpc:Rpc=async(method,params)=>{
  if(method==='eth_sendRawTransaction'){assert.deepEqual(params,[response.rawSignedTransaction]);sends++;seen=true;return tx.hash;}
  if(method==='eth_getTransactionByHash')return seen?actual:null;
  if(method==='eth_getTransactionReceipt')return receipted?{transactionHash:tx.hash,status:'0x1',blockHash,blockNumber:'0x10'}:null;
  if(method==='eth_getBlockByNumber')return params?.[0]==='pending'?{baseFeePerGas:'0xf4240'}:params?.[0]==='finalized'?{number:'0x10'}:{hash:blockHash,baseFeePerGas:'0xf4240'};
  assert.ok(Object.hasOwn(values,method));return values[method];
 };
 const action={action:'broadcast',wallet,request,response,consent:true};const store=walletSubmissionFixture();
 await assert.rejects(walletAction({...action,consent:false},rpc,true,store));assert.equal(sends,0);
 assert.equal((await walletAction(action,rpc,false,store) as any).state,'verified-only');assert.equal(sends,0);
 assert.equal((await walletAction({action:'preflight',wallet,request,response},rpc,false,store) as any).state,'ready');
 assert.equal((await walletAction(action,rpc,true,store) as any).state,'submitted');assert.equal(sends,1);
 receipted=true;assert.equal((await walletAction({action:'status',request,hash:tx.hash},rpc,false,store) as any).state,'confirmed');
 assert.equal((await walletAction(action,rpc,true,store) as any).state,'confirmed');assert.equal(sends,1);
 const result={kind:'exact-guest-native-transfer-synthetic-online-rehearsal',sourceImageSha256:report.sourceSha256,harnessResultSha256:createHash('sha256').update(harnessBytes).digest('hex'),fileDigests:digests,requestFingerprint:request.fingerprint,transactionHash:tx.hash,checks:{originalInjectedRequestAndWalletBound:true,signatureAndExactUnsignedBytes:true,signerMatchesPublicExport:true,missingConsentRejected:true,disabledGatePreventsSyntheticSend:true,explicitSyntheticSubmissionExactBytes:true,syntheticReceiptReconciled:true,noDuplicateSyntheticSend:true},syntheticRPCSendCount:sends,externalRPCRequests:0,realFunds:0,actualChainSettlement:false,fundingReady:false,success:true};
 writeFileSync(path.join(root,'native-transfer-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Guest native transfer verification failed. No readiness claim.');process.exitCode=1;});
