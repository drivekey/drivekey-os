'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Transaction}=require('ethers'),f=require('./fixtures/lifi-relay-intents.json'),c=require('../dist/lifi-relay.cjs');
const {currentRelayRequest}=require('./helpers/current-relay-request.cjs');
test('Relay preserves the original signed order and historical fee target, and rejects legacy fresh or mixed targets',()=>{
 const {LEGACY_LIFI_FEE_FORWARDER,LIFI_EVM}=require('../dist/lifi-evm.cjs');
 const {historicalReview}=require('../ui-routes-main.cjs');
 const {bridgeCodec}=require('../tools/bridge-intent-codecs.cjs');
 const {request:legacy,checkedAt}=f.cases.find(entry=>entry.request.version===26),now=Date.parse(checkedAt);
 const current=currentRelayRequest(legacy);
 assert.deepEqual(current.relayProtocol,legacy.relayProtocol);
 assert.throws(()=>c.validateLifiRelay(legacy,now),/fee forwarder/);
 assert.equal(historicalReview(legacy,bridgeCodec).fingerprint,legacy.fingerprint);
 assert.deepEqual(c.lifiRelayEvmFeeForwarder(Transaction.from(legacy.unsignedTransaction).data,true),LEGACY_LIFI_FEE_FORWARDER);
 assert.deepEqual(c.lifiRelayEvmFeeForwarder(Transaction.from(current.unsignedTransaction).data),LIFI_EVM.feeForwarder);
 const tx=Transaction.from(current.unsignedTransaction),call=c.LIFI_RELAY_ABI.parseTransaction({data:tx.data}),args=call.args.toArray(true);
 for(const [callTo,approveTo] of [
  [LIFI_EVM.feeForwarder.address,LEGACY_LIFI_FEE_FORWARDER.address],
  ['0x0000000000000000000000000000000000000001','0x0000000000000000000000000000000000000001'],
 ]){
  args[1][0][0]=callTo;args[1][0][1]=approveTo;
  tx.data=c.LIFI_RELAY_ABI.encodeFunctionData(call.fragment,args);
  const changed={...current,unsignedTransaction:tx.unsignedSerialized};changed.fingerprint=c.lifiRelayFingerprint(changed);
  assert.throws(()=>c.validateLifiRelay(changed,now,false),/fee call|fee forwarder/);
 }
});
test('finite LI.FI Relay source intents independently reconstruct native Ethereum and USDC Solana deposits',()=>{for(const x of f.cases){const r=c.validateLifiRelay(currentRelayRequest(x.request),Date.parse(x.checkedAt)),review=c.lifiRelayReview(r,Date.parse(x.checkedAt));assert.equal(r.fingerprint,c.lifiRelayFingerprint(r));assert.equal(review.minimumOutput,r.minimumOutput);assert.equal(review.composition,'new-canonical-lifi-execution-with-independent-relay-order');assert.equal(review.allowances,'None');assert.equal(x.financialSignature,false);assert.equal(x.executionVerified,false);assert.equal(BigInt(review.depositoryInput)+BigInt(review.protocolFee),BigInt(review.grossInput));}});
test('Relay intent rejects stale approval, changed solver output, excessive fees, wrong chain and hidden native calls',()=>{for(const x of f.cases){const at=Date.parse(x.checkedAt);for(const mutate of [r=>r.relayProtocol.orderData.output.payments[0].minimumAmount='1',r=>r.protocolFee='1',r=>r.recipient=r.version===25?'0x0000000000000000000000000000000000000001':'11111111111111111111111111111111',r=>r.network='testnet',r=>r.slippageBps=101,r=>r.composition='opaque-provider-transaction']){const r=currentRelayRequest(x.request);mutate(r);r.fingerprint=c.lifiRelayFingerprint(r);assert.throws(()=>c.validateLifiRelay(r,at));}assert.throws(()=>c.validateLifiRelay(currentRelayRequest(x.request),Date.parse(x.request.expiresAt)));assert.throws(()=>c.assertLifiRelayWallet(x.request,{deviceId:'00000000-0000-4000-8000-000000000000',evmAddress:x.request.from,solanaAddress:x.request.from}));}const x=f.cases.find(x=>x.request.version===26),r=currentRelayRequest(x.request),t=Transaction.from(r.unsignedTransaction);t.to='0x0000000000000000000000000000000000000001';r.unsignedTransaction=t.unsignedSerialized;r.fingerprint=c.lifiRelayFingerprint(r);assert.throws(()=>c.validateLifiRelay(r,Date.parse(x.checkedAt)));});
test('Relay Solana source rejects extra account rent and altered blockhash or amount before signing',()=>{const x=f.cases.find(x=>x.request.version===25);for(const change of [{accountRent:'1'},{blockhash:'11111111111111111111111111111111'},{amount:'500001'},{maximumFee:'47450'}]){const r={...x.request,...change};r.fingerprint=c.lifiRelayFingerprint(r);assert.throws(()=>c.validateLifiRelay(r,Date.parse(x.checkedAt)));}});
