'use strict';
// Public historical proofs and unsigned transaction binding. No new signature,
// provider/network, native approval or current-release mainnet qualification.
const {test}=require('node:test'),assert=require('node:assert/strict'),{Transaction}=require('ethers');
const {document,now,providerChainRequest}=require('./helpers/provider-chain-fixture.cjs'),core=require('../dist/hinkal-product-chain.cjs'),admission=require('../dist/hinkal-product-admission.cjs'),{hinkalFingerprint,HINKAL_ABI}=require('../dist/hinkal.cjs'),{providerEvmSignedMessageHash}=require('../dist/hinkal-provider-evm-hash.cjs');
test('provider deposit admission retains exact proof bytes, value, fee/nonce ceiling and full v29 approval',async()=>{
 const inner=providerChainRequest(),r=await core.createProductChain(document,document.request.wallet,inner,now),verified=await core.verifyProductChain(r,document.request.wallet,now),review=core.productChainReview(r,now);assert.deepEqual(verified.package,document);assert.equal(verified.chainRequest.version,10);assert.equal(review.action,'hinkal-deposit');assert.equal(review.baseUnits,'1');assert.equal(review.productMaximumFee,document.request.seed.maximumFee);assert.equal(review.productProofFingerprint,document.request.fingerprint);assert.equal(review.maximumFeeBaseUnits,inner.maximumFee);assert.equal(review.productApprovalDeadlineUTC,document.request.expiresAt);assert.equal(Transaction.from(inner.unsignedTransaction).value,1n);assert.equal((await providerEvmSignedMessageHash(document.result.proof.transaction.data)).toString(),document.request.seed.job.response.signedMessageHash);
 const later=Date.parse(r.expiresAt)+1;await assert.rejects(core.verifyProductChain(r,document.request.wallet,later));await core.verifyProductChain(r,document.request.wallet,later,false);assert.equal(core.productChainReview(r,later,false).baseUnits,'1');
});
test('changing fee, nonce, exact calldata, recipient, lifetime or wallet metadata cannot detach provider approval',async()=>{
 for(const change of [r=>{const tx=Transaction.from(r.unsignedTransaction);tx.nonce++;r.unsignedTransaction=tx.unsignedSerialized;},r=>{const tx=Transaction.from(r.unsignedTransaction);tx.maxFeePerGas=2000000000n;r.maximumFee='150000000000000';r.unsignedTransaction=tx.unsignedSerialized;},r=>r.recipient='0x'+'11'.repeat(20),r=>r.expiresAt=new Date(Date.parse(document.request.expiresAt)+1).toISOString(),r=>{const tx=Transaction.from(r.unsignedTransaction);tx.data+='00';r.unsignedTransaction=tx.unsignedSerialized;}]){const inner=providerChainRequest();change(inner);inner.fingerprint=hinkalFingerprint(inner);await assert.rejects(admission.verifyProductPackageChain(document,document.request.wallet,inner,now));}
 await assert.rejects(admission.verifyProductPackageChain(document,{...document.request.wallet,createdAt:new Date(0).toISOString()},providerChainRequest(),now));
 const changed=structuredClone(document);changed.result.proof.providerEnvelope.data+=' ';await assert.rejects(admission.verifyProductPackageChain(changed,document.request.wallet,providerChainRequest(),now));
});
test('provider proof results cannot authorize token approval/revoke, another seed/version or a substituted transaction',async()=>{
 const inner=providerChainRequest();for(const version of [18,16,21,9]){const changed={...inner,version};await assert.rejects(core.createProductChain(document,document.request.wallet,changed,now));}const altered=structuredClone(document);altered.request.seed.version=19;await assert.rejects(core.createProductChain(altered,document.request.wallet,inner,now));
 const wrong=structuredClone(document);wrong.result.proof.transaction.value='0';await assert.rejects(admission.verifyProductPackageChain(wrong,document.request.wallet,inner,now));
});
test('public calldata hash reconstruction rejects changed non-public permissions before Groth16 verification',async()=>{
 const args=HINKAL_ABI.decodeFunctionData('transact',document.result.proof.transaction.data).toArray(true),fields=HINKAL_ABI.getFunction('transact').inputs[4].components,index=fields.findIndex(f=>f.name==='extraData');args[4][index]='0x01';await assert.rejects(providerEvmSignedMessageHash(HINKAL_ABI.encodeFunctionData('transact',args)),/calldata hash differs/);
});
test('retained Solana private-payment wire reconstructs exact 1x2x2 proof and passes genuine math only',async()=>{
 const r=require('./fixtures/hinkal-solana-private-payment.json').request,{providerSolanaArgsFromSpend}=require('../dist/hinkal-solana-spend.cjs'),{verifyProviderSolanaGroth16}=require('../dist/hinkal-provider-proof.cjs'),a=providerSolanaArgsFromSpend(r);assert.deepEqual(a.dimensions,{tokenNumber:1,nullifierAmount:2,outputAmount:2});assert.equal(a.relayerFee,'0');assert.equal(a.variableRate,'0');assert.equal(a.relayAddress,r.from);assert.equal((await verifyProviderSolanaGroth16(a)).verificationProfile,'1x2x2');
 for(const change of [x=>x.proofAArr[0]+=256,x=>x.proofBArr[0]=-1,x=>x.proofCArr[0]=0.5,x=>x.publicInputsArr[0][0]+=256,x=>x.proofAArr[0]^=1]){const altered=structuredClone(a);change(altered);await assert.rejects(verifyProviderSolanaGroth16(altered));}
 // This older fixture has no v28 wallet attestation or signed provider envelope.
 // A valid historical Groth16 proof cannot replace either mandatory authority.
 await assert.rejects(admission.verifyProductProofPackage({version:28,kind:'drivekey-hinkal-product-proof-package',request:r.proofSeed,response:r.proofAuthorization,result:{solanaArgs:a}},document.request.wallet,now,false));
});
