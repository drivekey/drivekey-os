'use strict';
// Explicit public-state doubles exercise binding logic; live RPC evidence is
// recorded separately and never inferred from these unit checks.
const {test}=require('node:test'),assert=require('node:assert/strict'),{AbiCoder,keccak256}=require('ethers');
const {HINKAL_ABI,HINKAL_PIN}=require('../dist/hinkal.cjs'),{providerEvmVerifierPin,assertProviderEvmVerifierSnapshot,verifyProviderEvmVerifier}=require('../dist/hinkal-provider-verifier.cjs'),p=require('./fixtures/provider-ethereum-deposit.json').package;
function data(profile){const args=HINKAL_ABI.decodeFunctionData('transact',p.result.proof.transaction.data).toArray(true);args[3]=profile.split('x').map(BigInt);return HINKAL_ABI.encodeFunctionData('transact',args);}
test('all four supported provider dimensions resolve only their exact registered key identity',()=>{
 for(const profile of ['1x2x1','1x2x2','1x6x1','1x6x2']){const pin=providerEvmVerifierPin(data(profile));assert.equal(pin.profile,profile);assert.equal(pin.verifierId,keccak256(AbiCoder.defaultAbiCoder().encode(['uint16','uint16','uint16','uint256'],[...profile.split('x'),0])));assert.match(pin.wrapperCodeHash,/^0x[a-f0-9]{64}$/);assert.match(pin.verifierCodeHash,/^0x[a-f0-9]{64}$/);}
 assert.throws(()=>providerEvmVerifierPin(data('2x2x1')));const args=HINKAL_ABI.decodeFunctionData('transact',p.result.proof.transaction.data).toArray(true),fields=HINKAL_ABI.getFunction('transact').inputs[4].components,index=fields.findIndex(c=>c.name==='externalActionData');args[4][index][1]=1n;assert.throws(()=>providerEvmVerifierPin(HINKAL_ABI.encodeFunctionData('transact',args)));
});
test('wrong wrapper/verifier, missing registration, changed code, reorg and inconsistent repeated reads fail closed',()=>{
 for(const profile of ['1x2x1','1x2x2','1x6x1','1x6x2']){const call=data(profile),pin=providerEvmVerifierPin(call),hash='0x'+'1'.repeat(64),snapshot={block:'0x1234',blockHash:hash,poolCodeHash:HINKAL_PIN.ethereumCodeHash,registrationBefore:pin.wrapper,wrapperCodeHash:pin.wrapperCodeHash,verifier:pin.verifier,verifierCodeHash:pin.verifierCodeHash,registrationAfter:pin.wrapper,finalBlockHash:hash};assert.equal(assertProviderEvmVerifierSnapshot(call,snapshot).verificationKeyHash,pin.canonicalKeySha256);
  for(const key of Object.keys(snapshot)){const changed={...snapshot,[key]:key==='block'?'latest':key.toLowerCase().includes('hash')?'0x'+'0'.repeat(64):'0x'+'0'.repeat(40)};assert.throws(()=>assertProviderEvmVerifierSnapshot(call,changed));}
 }
});
test('RPC verification refuses wrong chain or malformed header before subsequent public reads',async()=>{
 let calls=0;await assert.rejects(verifyProviderEvmVerifier({identity:async()=>{throw Error('Wrong chain fixture');},rpc:async()=>{calls++;}},p.result.proof.transaction.data),/Wrong chain/);assert.equal(calls,0);await assert.rejects(verifyProviderEvmVerifier({identity:async()=>{},rpc:async(_chain,method)=>{calls++;assert.equal(method,'eth_getBlockByNumber');return {number:'pending',hash:'0x00'};}},p.result.proof.transaction.data),/block is unavailable/);assert.equal(calls,1);
});
