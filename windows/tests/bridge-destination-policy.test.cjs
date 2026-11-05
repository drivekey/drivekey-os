'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireCandidate = Module.createRequire(path.join(root, 'package.json'));
const {authorizeBoundBridgeDestination} = require('../tools/bridge-destination-policy.cjs');
const {digest} = requireCandidate('./tools/acceptance-policy.cjs');
const {Transaction, keccak256} = requireCandidate('ethers');
const {validateMayanSolana} = requireCandidate('./dist/mayan-solana.cjs');
const {validateMayanEvmRedeem} = requireCandidate('./dist/mayan-evm-redeem.cjs');
const fixture = requireCandidate('./tests/fixtures/mayan-evm-redeem-local.json');
const {setup} = require('./helpers/mayan-destination-policy-fixture.cjs');
function authorize(value) {
  return authorizeBoundBridgeDestination(value.manifest, value.sourceManifest, value.sourceResponse, value.operation, value.state, value.identity,
    {validateMayanSolana, validateMayanEvmRedeem, cctpMessageHash: keccak256}, value.now);
}
test('exact synthetic source-bound redemption uses the existing reservation', () => {
  const value = setup();
  const result = authorize(value);
  assert.equal(result.destinationFingerprint, fixture.request.fingerprint);
  assert.equal(value.state.operations.length, 1);
  assert.equal(value.operation.actualUsdMicros, undefined);
});
test('destination rejects duplicate intent, changed source proof, release, binaries, balance and parent', () => {
  for (const mutate of [
    x => x.operation.destination = {state: 'reserved'},
    x => x.manifest.sourceFingerprint = 'e'.repeat(64),
    x => x.manifest.binaryHashes = {'worker.cjs': 'f'.repeat(64)},
    x => x.manifest.sourceFinality.sourceSlot++,
    x => x.manifest.sourceFinality.sourceMessageHash = '0x' + '0'.repeat(64),
    x => x.manifest.sourceFinality.sourceProofHash = 'd'.repeat(64),
    x => x.operation.sourceSlot++,
    x => x.operation.sourceMessage = '0x00',
    x => x.operation.sourceMessageHash = '0x' + '1'.repeat(64),
    x => x.manifest.nativeBalance = '0',
    x => x.manifest.parentFingerprint = '0x' + '2'.repeat(64),
    x => x.operation.destinationReservedUsdMicros = '0',
    x => x.manifest.simulation.endpoints = ['https://one.example/a', 'https://one.example/b'],
    x => x.operation.state = 'settled',
  ]) {
    const value = setup(); mutate(value);
    assert.throws(() => authorize(value));
  }
});
