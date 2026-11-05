'use strict';
// Genuine fresh local cryptography with synthetic owned notes/trees. No chain I/O.
const {test,before}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {productProofFixture}=require('../dist/hinkal-product-proof-fixture.cjs'),{localSolanaFixture}=require('./helpers/hinkal-local-solana-fixture.cjs');
const {createProductProof}=require('../dist/hinkal-product-proof.cjs'),{authorizeProductProof}=require('../dist/hinkal-product-proof-signer.cjs'),{proveProductProof}=require('../dist/hinkal-product-prover.cjs');
const {verifyProductProofResult}=require('../dist/hinkal-product-result.cjs'),{HINKAL_ABI}=require('../dist/hinkal.cjs'),{stageProofArtifacts}=require('../tools/proof-artifacts.cjs'),{HINKAL_PROVER_PINS}=require('../dist/hinkal-prover-pins.cjs');
const artifacts=process.env.DRIVEKEY_HINKAL_ARTIFACTS;
let fixtures=[];
before(async()=>{
 assert.ok(artifacts&&path.isAbsolute(artifacts),'Set DRIVEKEY_HINKAL_ARTIFACTS to the retained SHA-pinned artifact directory. Missing files are a failed proof gate, never a skip.');
 const evm=await productProofFixture(),s=await localSolanaFixture(),sol={vault:s.vault,password:s.password,view:s.view,request:createProductProof(s.seed,s.vault.public,s.view.spendingPublicKey)};
 for(const f of [evm,sol]){const response=await authorizeProductProof(f.vault,f.password,f.request,f.request.fingerprint),result=await proveProductProof(f.vault,f.password,f.request,response,artifacts);fixtures.push({...f,response,result});}
});
test('fresh Ethereum and Solana product authorizations generate genuine independently verified Groth16 results',async()=>{
 for(const f of fixtures){const r=await verifyProductProofResult(f.request,f.response,f.result);assert.equal(r.chain,f.request.chain);assert.equal(r.blockchainTransactionSigned,false);assert.equal(r.submitted,false);assert.equal(JSON.stringify(r).includes(f.password),false);assert.equal(JSON.stringify(r).includes('nullifyingKey'),false);assert.equal(Object.hasOwn(r,'rawSignedTransaction'),false);}
});
test('product proof results reject changed approval identities, authority, timestamps and extra secret fields',async()=>{
 for(const f of fixtures)for(const change of [r=>r.deviceId=crypto.randomUUID(),r=>r.authorizationHash='0x'+'0'.repeat(64),r=>r.createdAt=f.request.expiresAt,r=>r.chain=r.chain==='ethereum'?'solana':'ethereum',r=>r.password='forbidden']){const r=structuredClone(f.result);change(r);await assert.rejects(verifyProductProofResult(f.request,f.response,r));}
});
test('Ethereum proof validation binds non-public calldata to the exact approved route',async()=>{
 const f=fixtures[0],r=structuredClone(f.result),args=HINKAL_ABI.decodeFunctionData('transact',r.proof.data).toArray(true),index=HINKAL_ABI.getFunction('transact').inputs[4].components.findIndex(p=>p.name==='externalActionData');assert.ok(index>=0);args[4][index][2]='0x';r.proof.data=HINKAL_ABI.encodeFunctionData('transact',args);
 await assert.rejects(verifyProductProofResult(f.request,f.response,r));
 const changed=structuredClone(f.result),tx=HINKAL_ABI.decodeFunctionData('transact',changed.proof.data).toArray(true);tx[0][0]=(BigInt(tx[0][0])+1n).toString();changed.proof.data=HINKAL_ABI.encodeFunctionData('transact',tx);await assert.rejects(verifyProductProofResult(f.request,f.response,changed));
});
test('Solana proof validation rejects changed signals, proof coordinates, outputs, root index and artifact pins',async()=>{
 const f=fixtures[1];for(const change of [r=>r.proof.solanaArgs.publicInputsArr[0][31]^=1,r=>r.proof.solanaArgs.proofAArr[31]^=1,r=>r.proof.solanaArgs.rootHashIndex='1',r=>r.proof.solanaArgs.encryptedOutputs[1]=[1],r=>r.proof.provingArtifacts[0]='0'.repeat(64)]){const r=structuredClone(f.result);change(r);await assert.rejects(verifyProductProofResult(f.request,f.response,r));}
});
test('expired saved proof verification permits recovery without new proving or key authority',async()=>{
 for(const f of fixtures){const later=Date.parse(f.request.expiresAt)+1;await assert.rejects(verifyProductProofResult(f.request,f.response,f.result,later));await verifyProductProofResult(f.request,f.response,f.result,later,false);await assert.rejects(proveProductProof(f.vault,f.password,f.request,f.response,artifacts,later));}
 const f=fixtures[0];await assert.rejects(proveProductProof(f.vault,'Wrong unfunded fixture password',f.request,f.response,artifacts));await assert.rejects(proveProductProof(fixtures[1].vault,f.password,f.request,f.response,artifacts));
});
test('artifact staging rejects missing inputs, link redirects and hash mismatches before packaging',async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'drivekey-prover-artifacts-')),source=path.join(scratch,'input');await fs.mkdir(source);
 await assert.rejects(stageProofArtifacts(undefined,path.join(scratch,'none')));await assert.rejects(stageProofArtifacts(source,source));
 const pin=HINKAL_PROVER_PINS.ethereum.wasm;await fs.writeFile(path.join(source,pin.name),Buffer.alloc(pin.bytes));await assert.rejects(stageProofArtifacts(source,path.join(scratch,'bad')),/SHA-256/);
 const link=path.join(scratch,'redirect');await fs.symlink(source,link,'junction');await assert.rejects(stageProofArtifacts(link,path.join(scratch,'linked')),/regular directory/);
});
test('shipped dedicated worker refuses unqualified proving without disclosing its inputs',()=>{
 const f=fixtures[0],r=spawnSync(process.execPath,[path.resolve(__dirname,'../dist/product-proof-worker.cjs')],{input:JSON.stringify({action:'prove-product-proof',vault:f.vault,password:f.password,request:f.request,response:f.response,artifactDirectory:artifacts}),encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(r.status,1);const result=JSON.parse(r.stdout);assert.equal(result.ok,false);assert.equal(r.stdout.includes(f.password),false);assert.equal(r.stdout.includes(f.view.nullifyingKey),false);
});
test('dedicated prover bootstrap denies network transports before loading cryptographic dependencies',()=>{
 const script=`require('./dist/product-proof-worker.cjs');process.stdin.removeAllListeners('end');const assert=require('node:assert/strict');for(const operation of [()=>fetch('https://example.invalid'),()=>require('node:net').connect(443,'example.invalid'),()=>new(require('node:net').Socket)().connect(443,'example.invalid'),()=>require('node:https').request('https://example.invalid'),()=>require('node:http2').connect('https://example.invalid'),()=>require('node:dgram').createSocket('udp4'),()=>require('node:dns').lookup('example.invalid'),()=>require('node:dns').promises.resolve('example.invalid'),()=>new WebSocket('wss://example.invalid')])assert.throws(operation,/Networking is disabled/);process.stdout.write('network-denied');process.exit(0);`;
 const r=spawnSync(process.execPath,['--no-addons','-e',script],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'network-denied');
});
