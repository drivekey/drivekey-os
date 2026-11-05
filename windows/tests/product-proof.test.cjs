'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const {Wallet}=require('ethers');
const {productProofFixture}=require('../dist/hinkal-product-proof-fixture.cjs');
const {authorizeProductProof,reviewProductProof}=require('../dist/hinkal-product-proof-signer.cjs');
const {validateProductProof,productProofFingerprint,productProofReview,verifyProductProofResponse}=require('../dist/hinkal-product-proof.cjs');
let f,response;
before(async()=>{f=await productProofFixture();response=await authorizeProductProof(f.vault,f.password,f.request,f.request.fingerprint);});
test('fresh owned-note product authorization binds both wallet and circuit signatures without chain signing',async()=>{
 const verified=await verifyProductProofResponse(f.request,response),review=reviewProductProof(f.request,f.vault);
 assert.deepEqual(verified,response);assert.equal(verified.blockchainTransactionSigned,false);assert.equal(verified.submitted,false);
 assert.equal(Object.hasOwn(verified,'rawSignedTransaction'),false);assert.equal(Object.hasOwn(verified,'transactionHash'),false);
 assert.equal(review.recipient,f.vault.public.evmAddress);assert.equal(review.inputAsset,'ETH');assert.equal(review.outputAsset,'USDC');
 assert.equal(review.maximumFee,f.request.seed.maximumFee);assert.equal(review.minimumOutput,f.request.seed.job.context.minimumOutput);
 assert.equal(review.action,'private-proof-swap');assert.match(review.formattedInput,/ ETH$/);assert.match(review.formattedMinimum,/ USDC$/);
 assert.equal(JSON.stringify(verified).includes(f.password),false);assert.equal(JSON.stringify(f.request).includes('nullifyingKey'),false);
});
test('product proof validation rejects wrong wallets, networks, secret material and changed review identities',()=>{
 for(const change of [r=>r.deviceId=crypto.randomUUID(),r=>r.chain='solana',r=>r.wallet.evmAddress=Wallet.createRandom().address,
   r=>r.seed.job.response.privateKey='must never be imported',r=>r.seed.job.response.nullifyingKey='0x01',r=>r.seed.job.response.rawSignedTransaction='forbidden',
   r=>r.expectedSpendingPublicKey=['0','0'],r=>r.expiresAt=new Date(Date.parse(r.seed.expiresAt)+1).toISOString()]){
  const r=structuredClone(f.request);change(r);r.fingerprint=productProofFingerprint(r);assert.throws(()=>validateProductProof(r));
 }
 const vault=structuredClone(f.vault);vault.public.solanaAddress='11111111111111111111111111111111';assert.throws(()=>reviewProductProof(f.request,vault));
});
test('an exact product review cannot be reused for changed fees, nonce, notes or minimum output',async()=>{
 for(const change of [r=>r.seed.maximumFee='1',r=>r.seed.nonce++,r=>r.seed.job.context.minimumOutput='1',r=>r.seed.job.context.inputNotes[0]+='00']){
  const r=structuredClone(f.request);change(r);r.fingerprint=productProofFingerprint(r);await assert.rejects(verifyProductProofResponse(r,response));
 }
 await assert.rejects(authorizeProductProof(f.vault,f.password,f.request,'0x'+'0'.repeat(64)),/review changed/);
 await assert.rejects(authorizeProductProof(f.vault,'Wrong unfunded fixture passphrase',f.request,f.request.fingerprint));
});
test('legacy circuit responses, different wallet signatures and modified proof signatures cannot masquerade as product responses',async()=>{
 await assert.rejects(verifyProductProofResponse(f.request,response.proofAuthorization));
 for(const change of [s=>s.walletAuthorization='0x'+'11'.repeat(65),s=>s.proofAuthorization.authorization.S='1',s=>s.requestId=crypto.randomUUID(),s=>s.submitted=true]){
  const s=structuredClone(response);change(s);await assert.rejects(verifyProductProofResponse(f.request,s));
 }
});
test('expired product proofs remain verifiable for recovery but cannot create new approval authority',async()=>{
 const later=Date.parse(f.request.expiresAt)+1;
 assert.throws(()=>productProofReview(f.request,later));
 await assert.rejects(authorizeProductProof(f.vault,f.password,f.request,f.request.fingerprint,later));
 assert.deepEqual(await verifyProductProofResponse(f.request,response,later,false),response);
});
