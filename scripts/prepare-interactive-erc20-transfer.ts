// Source-only disposable token acceptance; never public-network preparation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {Wallet,Transaction,keccak256} from 'ethers';
import solc from 'solc';
import {multiPublicSchema,MULTI_TTL,SOLANA_GENESIS,canonicalSolTransaction,encodeSolUnsigned,multiFingerprint,validateMultiRequest,ERC20,type ErcRequest} from '../core/multi-protocol';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);assert(!existsSync(out));
const reportBytes=readFileSync(path.join(root,'result.json')),report=JSON.parse(reportBytes.toString());assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
const walletBytes=readFileSync(path.join(root,'wallet-output/wallet-multi-public.json'));assert.equal(hash(walletBytes),report.outputFiles.find((x:any)=>x.name==='wallet-multi-public.json')?.sha256);const wallet=multiPublicSchema.parse(JSON.parse(walletBytes.toString()));
mkdirSync(path.join(out,'wallet-output'),{recursive:true});writeFileSync(path.join(out,'result.json'),reportBytes);
for(const name of ['wallet-multi-public.json','vault-multi-backup.json']){const bytes=readFileSync(path.join(root,'wallet-output',name));assert.equal(hash(bytes),report.outputFiles.find((x:any)=>x.name===name)?.sha256);writeFileSync(path.join(out,'wallet-output',name),bytes);}
const source='pragma solidity ^0.8.30; contract FixtureToken { mapping(address=>uint256) public balanceOf; event Transfer(address indexed from,address indexed to,uint256 value); function transfer(address to,uint256 amount) external returns(bool) { require(balanceOf[msg.sender]>=amount); balanceOf[msg.sender]-=amount; balanceOf[to]+=amount; emit Transfer(msg.sender,to,amount); return true; } }';
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'FixtureToken.sol':{content:source}},settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}})));assert(!compiled.errors?.some((x:any)=>x.severity==='error'));
const bytecode='0x'+compiled.contracts['FixtureToken.sol'].FixtureToken.evm.deployedBytecode.object;const now=Date.now(),token=Wallet.createRandom().address,recipient=Wallet.createRandom().address;const tx=Transaction.from({type:2,chainId:4663,nonce:0,to:token,value:0,gasLimit:100000,maxFeePerGas:2000000000,maxPriorityFeePerGas:1000000000,data:ERC20.encodeFunctionData('transfer',[recipient,1234567n])});
const request:ErcRequest={version:3,requestId:randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+MULTI_TTL).toISOString(),fingerprint:'0x'+'00'.repeat(32),network:'robinhood',chainId:4663,standard:'erc20',from:wallet.evmAddress,recipient,token,amount:'1234567',decimals:6,codeHash:keccak256(bytecode),unsignedTransaction:tx.unsignedSerialized};
writeFileSync(path.join(out,'token-runtime.json'),JSON.stringify({source,bytecode,codeHash:keccak256(bytecode),compilerVersion:solc.version(),syntheticTestContract:true},null,2)+'\n');request.fingerprint=multiFingerprint(request);validateMultiRequest(request);const bytes=JSON.stringify(request,null,2)+'\n';writeFileSync(path.join(out,'unsigned-multi-request.json'),bytes);
writeFileSync(path.join(out,'synthetic-token.json'),JSON.stringify({kind:'unfunded-qmp-token-fixture',sourceImageSha256:report.sourceSha256,publicWalletSha256:hash(walletBytes),requests:{'unsigned-multi-request.json':{sha256:hash(bytes),fingerprint:request.fingerprint}},network:false,externalRPCRequests:0,realFunds:0,scope:'ERC20 transfer on chain4663; compiled synthetic test contract and injected source balance'},null,2)+'\n');
console.log('Bound disposable ERC20 request prepared; no network.');
