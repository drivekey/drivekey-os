/** Synthetic RPC preparation bound to a recorded unfunded QMP-generated wallet. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Wallet} from 'ethers';
import {prepareRequest,type Rpc} from '../core/protocol';
async function main(){
 const root=path.resolve(process.argv[2]);const report=JSON.parse(readFileSync(path.join(root,'result.json'),'utf8'));assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
 const raw=readFileSync(path.join(root,'wallet-output','wallet-public.json'));assert.equal(createHash('sha256').update(raw).digest('hex'),report.outputFiles.find((x:any)=>x.name==='wallet-public.json')?.sha256);
 const values:Record<string,unknown>={eth_chainId:'0x1237',eth_getTransactionCount:'0x0',eth_estimateGas:'0x186a0',eth_getBlockByNumber:{baseFeePerGas:'0xf4240'},eth_maxPriorityFeePerGas:'0x0',eth_getCode:'0x',eth_getBalance:'0xde0b6b3a7640000'};
 const calls:string[]=[];const rpc:Rpc=async method=>{assert.ok(Object.hasOwn(values,method));calls.push(method);return values[method];};
 const request=await prepareRequest(JSON.parse(raw.toString()),Wallet.createRandom().address,'0.0001',rpc);
 const bytes=JSON.stringify(request,null,2)+'\n';writeFileSync(path.join(root,'unsigned-request.json'),bytes);
 writeFileSync(path.join(root,'synthetic-transfer.json'),JSON.stringify({kind:'unfunded-qmp-native-transfer-fixture',sourceImageSha256:report.sourceSha256,publicWalletSha256:createHash('sha256').update(raw).digest('hex'),requestSha256:createHash('sha256').update(bytes).digest('hex'),network:false,externalRPCRequests:0,realFunds:0,chainId:4663,requestFingerprint:request.fingerprint,syntheticRPCCalls:calls},null,2)+'\n');
 console.log('Synthetic native request prepared for recorded disposable wallet. No network call.');
}
main().catch(()=>{console.error('Synthetic preparation failed.');process.exitCode=1;});
