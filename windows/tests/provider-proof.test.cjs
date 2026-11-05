'use strict';
// Historical genuine unfunded provider proof. Explicit recovery verification;
// no network, new authorization, settlement or current-release live success.
const {test}=require('node:test'),assert=require('node:assert/strict'),{Wallet,keccak256}=require('ethers');
const p=require('./fixtures/provider-ethereum-deposit.json').package,core=require('../dist/hinkal-provider-proof.cjs'),{verifyProductProofResult}=require('../dist/hinkal-product-result.cjs'),{HINKAL_ABI}=require('../dist/hinkal.cjs'),{HINKAL_BASE_FIELD,HINKAL_SCALAR}=require('../dist/hinkal-groth16.cjs');
const now=Date.parse(p.result.createdAt)+1000;
test('genuine signed provider result verifies original authorization, public signals and Groth16 offline',async()=>{
 const verified=await verifyProductProofResult(p.request,p.response,p.result,now,false);assert.deepEqual(verified,p.result);assert.equal(verified.proof.verificationProfile,'1x2x1');assert.equal(verified.blockchainTransactionSigned,false);assert.equal(verified.submitted,false);assert.deepEqual(core.providerProofFromEnvelope(p.request.seed,p.result.proof.providerEnvelope),p.result.proof);
 for(const chain of ['ethereum','solana'])for(const [profile,n]of Object.entries({'1x2x1':15,'1x2x2':16,'1x6x1':19,'1x6x2':20})){const pin=core.providerVerificationPin(chain,profile);assert.equal(pin.nPublic,n+(chain==='solana'?2:0));assert.match(pin.verificationKeyHash,/^[a-f0-9]{64}$/);}assert.throws(()=>core.providerVerificationPin('ethereum','2x6x2'));
});
test('provider finalization remains a historical recovery result after expiry and cannot authorize a new chain action',async()=>{
 const later=Date.parse(p.request.expiresAt)+1;await assert.rejects(verifyProductProofResult(p.request,p.response,p.result,later));await verifyProductProofResult(p.request,p.response,p.result,later,false);
 for(const change of [r=>delete r.finalizationStartedAt,r=>r.finalizationStartedAt=p.request.expiresAt,r=>r.finalizationStartedAt=new Date(Date.parse(p.response.signedAt)-1).toISOString(),r=>r.finalizationStartedAt=new Date(Date.parse(r.createdAt)+1).toISOString(),r=>r.authorizationHash='0x'+'0'.repeat(64)]){const r=structuredClone(p.result);change(r);await assert.rejects(verifyProductProofResult(p.request,p.response,r,now,false));}
 const delivered=structuredClone(p.result);delivered.createdAt=new Date(later+1).toISOString();await verifyProductProofResult(p.request,p.response,delivered,later+2,false);
});
test('provider origin is mandatory and no unrelated signer, changed signed body or extra envelope field is accepted',()=>{
 const envelope=p.result.proof.providerEnvelope,wallet=Wallet.createRandom();for(const changed of [{...envelope,data:envelope.data+' '},{...envelope,signature:wallet.signingKey.sign(keccak256(Buffer.from(envelope.data))).serialized},{...envelope,signature:'0x'+'00'.repeat(65)},{...envelope,privateKey:'forbidden'}])assert.throws(()=>core.providerProofFromEnvelope(p.request.seed,changed));
});
test('exported proof bytes, key dimensions, value, target and output ciphertext must exactly match signed provider body',async()=>{
 for(const change of [r=>delete r.proof.providerEnvelope,r=>r.proof.providerFinalized=false,r=>r.proof.verificationProfile='1x6x1',r=>r.proof.verificationKeyHash='0'.repeat(64),r=>r.proof.transaction.value='2',r=>r.proof.transaction.to=Wallet.createRandom().address,r=>r.proof.transaction.data+='00',r=>r.proof.extraPermission='forbidden']){const r=structuredClone(p.result);change(r);await assert.rejects(verifyProductProofResult(p.request,p.response,r,now,false));}
});
test('Groth16 rejects base-field aliases, scalar overflow, zero points and altered actual proof coordinates',async()=>{
 const rootIndex=HINKAL_ABI.getFunction('transact').inputs[4].components.findIndex(c=>c.name==='rootHashHinkal');
 for(const change of [a=>a[0][0]=(BigInt(a[0][0])+HINKAL_BASE_FIELD).toString(),a=>a[0]=['0','0'],a=>a[1][0][0]=(BigInt(a[1][0][0])+HINKAL_BASE_FIELD).toString(),a=>a[2][0]=(BigInt(a[2][0])+1n).toString(),a=>a[4][rootIndex]=HINKAL_SCALAR.toString()]){
  const args=HINKAL_ABI.decodeFunctionData('transact',p.result.proof.transaction.data).toArray(true);change(args);const data=HINKAL_ABI.encodeFunctionData('transact',args);await assert.rejects(core.verifyProviderEvmGroth16(data,p.request.seed.job.response.signedMessageHash));
 }
 await assert.rejects(core.verifyProviderEvmGroth16(p.result.proof.transaction.data,'1'));
});
