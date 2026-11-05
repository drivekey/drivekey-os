'use strict';
// Genuine fresh unfunded ownership inspection. No provider, circuit approval,
// transaction signing or intended-mainnet state is inferred from these notes.
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const {productProofFixture}=require('../dist/hinkal-product-proof-fixture.cjs'),{localSolanaFixture}=require('./helpers/hinkal-local-solana-fixture.cjs'),{createProductProof,productProofFingerprint}=require('../dist/hinkal-product-proof.cjs'),{inspectProductNotes}=require('../dist/private-note-manifest-signer.cjs'),core=require('../dist/private-note-manifest.cjs');
const fixtures=[];before(async()=>{const evm=await productProofFixture(),s=await localSolanaFixture(),sol={vault:s.vault,password:s.password,request:createProductProof(s.seed,s.vault.public,s.view.spendingPublicKey)};for(const f of [evm,sol])fixtures.push({...f,manifest:await inspectProductNotes(f.vault,f.password,f.request)});});
test('wallet-derived note identities and exact private gross inputs are deterministic on both chains',async()=>{
 for(const f of fixtures){const m=f.manifest,amount=f.request.seed.job.context.amount;assert.equal(m.inputs.length,1);assert.equal(m.privateInputTotal,(BigInt(amount)*(f.request.chain==='ethereum'?2n:1n)).toString());assert.equal(m.expectedPrivateChange,f.request.chain==='ethereum'?amount:'0');assert.equal(m.amount,amount);assert.equal(m.requestFingerprint,f.request.fingerprint);assert.equal(m.chain,f.request.chain);assert.deepEqual(await inspectProductNotes(f.vault,f.password,f.request),m);assert.deepEqual(core.validatePrivateNoteManifest(f.request,m),m);for(const text of [f.password,'nullifyingKey','privateKey','rawSignedTransaction','walletAuthorization'])assert.equal(JSON.stringify(m).includes(text),false);}
});
test('wrong wallet/password/spending point and malformed encrypted notes fail before any authority',async()=>{
 for(const f of fixtures){await assert.rejects(inspectProductNotes(f.vault,'Incorrect unfunded fixture passphrase',f.request));await assert.rejects(inspectProductNotes(fixtures.find(x=>x!==f).vault,f.password,f.request));const changed=structuredClone(f.request);changed.expectedSpendingPublicKey=['1','2'];changed.fingerprint=productProofFingerprint(changed);await assert.rejects(inspectProductNotes(f.vault,f.password,changed));}
});
test('refingerprinted manifests cannot change wallet, asset, amount, totals, note count, ciphertext or scalar bounds',()=>{
 for(const f of fixtures)for(const change of [m=>m.walletHash='0'.repeat(64),m=>m.asset='USDC',m=>m.amount='1',m=>m.privateInputTotal='1',m=>m.expectedPrivateChange='1',m=>m.inputs=[],m=>m.inputs[0].ciphertextHash='0'.repeat(64),m=>m.inputs[0].commitment='0',m=>m.inputs[0].nullifier=(1n<<255n).toString(),m=>m.inputs[0].amount='0',m=>m.extra='forbidden']){const m=structuredClone(f.manifest);change(m);m.fingerprint=core.noteManifestFingerprint(m);assert.throws(()=>core.validatePrivateNoteManifest(f.request,m));}
});
test('expired original requests remain readable for recovery but cannot trigger new key-bearing inspection',async()=>{
 for(const f of fixtures){const later=Date.parse(f.request.expiresAt)+1;await assert.rejects(inspectProductNotes(f.vault,f.password,f.request,later));assert.deepEqual(core.validatePrivateNoteManifest(f.request,f.manifest,later,false),f.manifest);}
});
test('the final authorization child independently checks the exact reserved manifest before circuit signing',async()=>{
 const f=fixtures[0],{authorizeProductProof}=require('../dist/hinkal-product-proof-signer.cjs');await assert.rejects(authorizeProductProof(f.vault,f.password,f.request,f.request.fingerprint,Date.now(),'0'.repeat(64)),/manifest differs/);const response=await authorizeProductProof(f.vault,f.password,f.request,f.request.fingerprint,Date.now(),f.manifest.fingerprint);assert.equal(response.blockchainTransactionSigned,false);assert.equal(response.fingerprint,f.request.fingerprint);
});
test('final review exposes exact gross/change amounts without private note identities or spending capability',()=>{
 for(const f of fixtures){const review=core.privateNoteReview(f.request,f.manifest);assert.equal(review.privateInputTotalBaseUnits,f.manifest.privateInputTotal);assert.equal(review.expectedPrivateChangeBaseUnits,f.manifest.expectedPrivateChange);assert.match(review.independentlyOwnedPrivateInputs,new RegExp(' '+f.manifest.asset+'$'));assert.equal(review.reservedInputCount,'1');for(const value of [f.manifest.inputs[0].commitment,f.manifest.inputs[0].nullifier,f.request.seed.job.context.inputNotes[0],f.password])assert.equal(JSON.stringify(review).includes(value),false);}
});
