// Source-only disposable token acceptance; never public-network preparation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {Keypair} from '@solana/web3.js';
import {multiPublicSchema,MULTI_TTL,SOLANA_GENESIS,canonicalSolTransaction,encodeSolUnsigned,multiFingerprint,validateMultiRequest,type SolRequest} from '../core/multi-protocol';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);assert(!existsSync(out));
const reportBytes=readFileSync(path.join(root,'result.json')),report=JSON.parse(reportBytes.toString());assert.equal(report.kind,'external-qmp-wallet-exercise');assert.equal(report.success,true);assert.equal(report.network,false);assert.equal(report.fundingReady,false);
const walletBytes=readFileSync(path.join(root,'wallet-output/wallet-multi-public.json'));assert.equal(hash(walletBytes),report.outputFiles.find((x:any)=>x.name==='wallet-multi-public.json')?.sha256);const wallet=multiPublicSchema.parse(JSON.parse(walletBytes.toString()));
mkdirSync(path.join(out,'wallet-output'),{recursive:true});writeFileSync(path.join(out,'result.json'),reportBytes);
for(const name of ['wallet-multi-public.json','vault-multi-backup.json']){const bytes=readFileSync(path.join(root,'wallet-output',name));assert.equal(hash(bytes),report.outputFiles.find((x:any)=>x.name===name)?.sha256);writeFileSync(path.join(out,'wallet-output',name),bytes);}
const now=Date.now();const request:SolRequest={version:3,requestId:randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+MULTI_TTL).toISOString(),fingerprint:'0x'+'00'.repeat(32),network:'solana',genesisHash:SOLANA_GENESIS,standard:'spl',from:wallet.solanaAddress,recipient:Keypair.generate().publicKey.toBase58(),token:Keypair.generate().publicKey.toBase58(),amount:'1234567',decimals:6,nonceAccount:Keypair.generate().publicKey.toBase58(),nonceValue:Keypair.generate().publicKey.toBase58(),maximumFee:'5000',accountRent:'2039280',createRecipientAccount:true,unsignedTransaction:''};
request.unsignedTransaction=encodeSolUnsigned(canonicalSolTransaction(request));request.fingerprint=multiFingerprint(request);validateMultiRequest(request);const bytes=JSON.stringify(request,null,2)+'\n';writeFileSync(path.join(out,'unsigned-multi-request.json'),bytes);
writeFileSync(path.join(out,'synthetic-token.json'),JSON.stringify({kind:'unfunded-qmp-token-fixture',sourceImageSha256:report.sourceSha256,publicWalletSha256:hash(walletBytes),requests:{'unsigned-multi-request.json':{sha256:hash(bytes),fingerprint:request.fingerprint}},network:false,externalRPCRequests:0,realFunds:0,scope:'Classic SPL transfer with recipient ATA creation; synthetic mint and nonce state'},null,2)+'\n');
console.log('Bound disposable classic SPL request prepared; no network.');
