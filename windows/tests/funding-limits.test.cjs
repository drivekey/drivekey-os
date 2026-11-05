'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {authorizeFunding, digest} = require('../tools/acceptance-policy.cjs');
const {fundingHistory} = require('../tools/protected-test-profile.cjs');

function fixture(topup = false) {
  const now = Date.now();
  const request = {chain: 'ethereum', network: 'ethereum', asset: 'ETH', deviceId: 'funding-device', from: 'funding-address', recipient: 'source-address', fingerprint: 'new-request', amount: topup ? '1500000000000000' : '1000000000000', maximumFee: '1000000000000', accountRent: '0'};
  const identity = {fundingSource: {deviceId: request.deviceId, evmAddress: request.from}, source: {deviceId: 'source-device', evmAddress: request.recipient}, usdc: {ethereum: 'canonical'}};
  const state = {sessionId: 'session', sourceFingerprint: 'source', operations: [], fundingCommittedUsdMicros: '0', additionalFundingTransfers: 0};
  const manifest = {version: 1, kind: 'disposable-funding-authorization', sessionId: state.sessionId, sourceFingerprint: state.sourceFingerprint, routeId: 'funding', request, requestFingerprint: request.fingerprint, minimumOutput: request.amount, slippageBps: 0, tokenContract: 'native', stopConditions: ['uncertain-broadcast'], valuation: {observedAt: now, nativeUsdMicros: '2000000000', assetUsdMicros: '2000000000', sources: ['https://first.example', 'https://second.example']}, simulation: {passed: true, fingerprint: request.fingerprint, observedAt: now}, nativeBalance: '100000000000000000', nativeReserve: request.maximumFee};
  if (topup) Object.assign(manifest, {additionalFundingAuthorization: 'ETHEREUM-TOPUP-AUTHORIZATION.json', caseId: 'ethereum-gas-topup', fundingCeilingUsdMicros: '7500000', priorFundingGrossUsdMicros: '0'});
  return {manifest, state, identity, now};
}
function authorize(value) {
  return authorizeFunding(value.manifest, value.state, value.identity, request => request, value.now);
}

test('funding uses its independently supplied combined ceiling', () => {
  const value = fixture();
  assert.equal(authorize(value).reservedUsdMicros, '4000');
  value.state.fundingCommittedUsdMicros = '3996000';
  assert.doesNotThrow(() => authorize(value));
  value.state.fundingCommittedUsdMicros = '3996001';
  assert.throws(() => authorize(value), /funding ceiling/);
  value.manifest.routeId = 'different-route';
  value.state.fundingCommittedUsdMicros = '7500000';
  assert.throws(() => authorize(value), /funding ceiling/);
});

test('top-up is exact, bounded and consumed once across route changes', () => {
  const value = fixture(true);
  assert.equal(authorize(value).reservedUsdMicros, '3002000');
  value.state.additionalFundingTransfers = 1;
  value.manifest.routeId = 'new-route';
  assert.throws(() => authorize(value), /exhausted/);
  value.state.additionalFundingTransfers = 0;
  value.manifest.request.amount = '1500000000000001';
  value.manifest.minimumOutput = value.manifest.request.amount;
  assert.throws(() => authorize(value), /approved ETH top-up/);
});

test('top-up caps reject forged prior totals and excess gross cost', () => {
  for (const mutate of [
    value => { value.state.fundingCommittedUsdMicros = '1'; },
    value => { value.manifest.valuation.assetUsdMicros = value.manifest.valuation.nativeUsdMicros = '2400000000'; },
    value => { value.state.fundingCommittedUsdMicros = value.manifest.priorFundingGrossUsdMicros = '4500000'; },
    value => { value.manifest.fundingCeilingUsdMicros = '999999999'; },
    value => { delete value.state.fundingCommittedUsdMicros; },
    value => { delete value.state.additionalFundingTransfers; },
  ]) {
    const value = fixture(true);
    mutate(value);
    assert.throws(() => authorize(value));
  }
});

test('funding history verifies manifests and retains pending reservations and spent grants', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-funding-history-'));
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(directory).startsWith('drivekey-funding-history-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const state = {operations: []};
  function add(fingerprint, manifest, amounts) {
    const operation = {fingerprint, manifestHash: digest(manifest), state: 'settled', ...amounts};
    fs.writeFileSync(path.join(directory, fingerprint.slice(2) + '.manifest.json'), JSON.stringify(manifest));
    state.operations.push(operation);
    return operation;
  }
  add('0xinitial', {kind: 'disposable-funding-authorization'}, {actualUsdMicros: '1000000'});
  add('0xrelay', {kind: 'disposable-relay-source-authorization', signingRole: 'funding', request: {version: 26}}, {state: 'submitting', reservedUsdMicros: '2000000', actualUsdMicros: '100'});
  add('0xtopup', {kind: 'disposable-funding-authorization', additionalFundingAuthorization: 'ETHEREUM-TOPUP-AUTHORIZATION.json'}, {actualUsdMicros: '3400000'});
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(fundingHistory(directory, restored), {fundingCommittedUsdMicros: '6400000', additionalFundingTransfers: 1});
  fs.writeFileSync(path.join(directory, 'topup.manifest.json'), '{}');
  assert.throws(() => fundingHistory(directory, restored), /manifest changed/);
  fs.unlinkSync(path.join(directory, 'topup.manifest.json'));
  assert.throws(() => fundingHistory(directory, restored), /Missing prior/);
});
