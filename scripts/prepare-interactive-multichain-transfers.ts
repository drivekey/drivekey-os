// Host-only synthetic fixtures, bound to an actual disposable guest public export.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {Wallet} from 'ethers';
import {Keypair} from '@solana/web3.js';
import {multiPublicSchema,MULTI_TTL,SOLANA_GENESIS,canonicalSolTransaction,encodeSolUnsigned,multiFingerprint,validateMultiRequest,type SolRequest} from '../core/multi-protocol';
import {prepareTrade} from '../core/trade-online';
import type {Rpc} from '../core/protocol';
const hash=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex');
async function main(){
 const root=path.resolve(process.argv[2]);const report=JSON.parse(readFileSync(path.join(root,'result.json'),'utf8'));
 assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
 const raw=readFileSync(path.join(root,'wallet-output','wallet-multi-public.json'));assert.equal(hash(raw),report.outputFiles.find((x:any)=>x.name==='wallet-multi-public.json')?.sha256);
 const wallet=multiPublicSchema.parse(JSON.parse(raw.toString()));const now=Date.now();
 const sol:SolRequest={version:3,requestId:randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+MULTI_TTL).toISOString(),fingerprint:'0x'+'00'.repeat(32),network:'solana',genesisHash:SOLANA_GENESIS,standard:'native',from:wallet.solanaAddress,recipient:Keypair.generate().publicKey.toBase58(),token:'native',amount:'100000',decimals:9,nonceAccount:Keypair.generate().publicKey.toBase58(),nonceValue:Keypair.generate().publicKey.toBase58(),maximumFee:'5000',accountRent:'0',createRecipientAccount:false,unsignedTransaction:''};
 sol.unsignedTransaction=encodeSolUnsigned(canonicalSolTransaction(sol));sol.fingerprint=multiFingerprint(sol);validateMultiRequest(sol);
 const values:Record<string,unknown>={eth_chainId:'0x1',eth_getTransactionCount:'0x0',eth_estimateGas:'0x5208',eth_getBlockByNumber:{baseFeePerGas:'0x3b9aca00',number:'0x100',hash:'0x'+'11'.repeat(32)},eth_maxPriorityFeePerGas:'0x3b9aca00',eth_getCode:'0x',eth_getBalance:'0xde0b6b3a7640000',eth_call:'0x'};
 const calls:string[]=[];const rpc:Rpc=async method=>{assert.ok(Object.hasOwn(values,method));calls.push(method);return values[method];};
 const eth=await prepareTrade({wallet,kind:'payment',tokenIn:'ETH',amount:'0.000001',recipient:Wallet.createRandom().address},rpc,now);assert.equal(eth.state,'prepared');assert.ok(eth.request);
 const requests:Record<string,{sha256:string,fingerprint:string}>={};
 for(const [name,r]of [['unsigned-multi-request.json',sol],['unsigned-trade-request.json',eth.request]]as const){const bytes=JSON.stringify(r,null,2)+'\n';writeFileSync(path.join(root,name),bytes);requests[name]={sha256:hash(bytes),fingerprint:r.fingerprint};}
 writeFileSync(path.join(root,'synthetic-multichain.json'),JSON.stringify({kind:'unfunded-qmp-multichain-fixtures',sourceImageSha256:report.sourceSha256,publicWalletSha256:hash(raw),requests,network:false,externalRPCRequests:0,realFunds:0,solanaNonceState:'synthetic-uninitialized-not-chain-usable',syntheticEthereumRPCCalls:calls},null,2)+'\n');
 console.log('Two unfunded synthetic requests prepared; no chain calls or nonce account creation.');
}
main().catch(()=>{console.error('Multichain preparation failed.');process.exitCode=1;});
