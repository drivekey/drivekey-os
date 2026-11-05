'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const requireCandidate = createRequire(path.join(root, 'package.json'));
const {dpapi} = requireCandidate('./tools/protected-test-profile.cjs');
const {digest} = requireCandidate('./tools/acceptance-policy.cjs');
const {Transaction, Interface} = requireCandidate('ethers');
const {CHAINS} = requireCandidate('./dist/payment.cjs');
const {MAYAN_EVM_PINS} = requireCandidate('./dist/lifi-mayan-evm.cjs');
const sourceFixtures = [requireCandidate('./tests/fixtures/lifi-mayan-evm-source.json'), requireCandidate('./tests/fixtures/mayan-solana-source.json')];
function setup(t, fixture, state = 'reserved') {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-mayan-cli-fixture-'));
  t.after(() => {
    const resolved = path.resolve(local);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('drivekey-mayan-cli-fixture-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  const sessionId = randomUUID();
  const directory = path.join(local, 'DriveKeyAcceptance', sessionId);
  fs.mkdirSync(directory, {recursive: true});
  const request = fixture.request;
  const source = {deviceId: request.deviceId, evmAddress: request.version === 22 ? request.from : request.recipient, solanaAddress: request.version === 22 ? request.recipient : request.from};
  const manifest = {fixtureOnly: true, request, valuation: {usdcUsdMicros: '1000000', ethereumUsdMicros: '3000000000', solanaUsdMicros: '100000000'}};
  const operation = {kind: 'bridge', fingerprint: request.fingerprint, sourceVersion: request.version, state,
    manifestHash: digest(manifest), reservedUsdMicros: '5000000', sourceMaximumUsdMicros: '4700000', destinationReservedUsdMicros: '300000'};
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  write('public.json', {sessionId, fixtureOnly: true, source});
  write('ledger.json', {sessionId, operations: [operation], permissions: []});
  write(request.fingerprint.slice(2) + '.manifest.json', manifest);
  fs.writeFileSync(path.join(directory, request.fingerprint.slice(2) + '.response.dpapi'), dpapi('protect', Buffer.from(JSON.stringify(fixture.response))));
  const call = job => {
    const result = spawnSync(process.execPath, [path.join(root, 'tools/protected-test-profile.cjs')], {env: {...process.env, LOCALAPPDATA: local}, input: JSON.stringify({sessionId, ...job}), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024});
    if (!result.stdout) throw Error('Isolated protected CLI returned no response.');
    return JSON.parse(result.stdout);
  };
  return {directory, call, operation, manifest, write};
}
function sourceObservation(fixture) {
  if (fixture.request.version === 23) return {sourceState: 'confirmed', receipt: fixture.receipt, messageAccount: fixture.messageAccount,
    messageAccountContextSlot: fixture.receipt.slot, finalityVerified: true, finalizedStatus: {confirmationStatus: 'finalized', slot: fixture.receipt.slot, err: null}};
  const signed = Transaction.from(fixture.response.rawSignedTransaction);
  const fee = BigInt(fixture.receipt.gasUsed) * BigInt(fixture.receipt.effectiveGasPrice);
  return {sourceState: 'confirmed', receipt: fixture.receipt, allowance: '0', finalityVerified: true,
    canonicalBlock: {number: fixture.receipt.blockNumber, hash: fixture.receipt.blockHash, parentHash: '0x' + 'a'.repeat(64), transactions: [signed.hash]},
    previousBlock: {number: '0x' + (BigInt(fixture.receipt.blockNumber) - 1n).toString(16), hash: '0x' + 'a'.repeat(64)},
    finalizedBlock: {number: fixture.receipt.blockNumber},
    observedTransaction: {...fixture.transaction, type: '0x2', gas: '0x' + signed.gasLimit.toString(16), maxFeePerGas: '0x' + signed.maxFeePerGas.toString(16), maxPriorityFeePerGas: '0x' + signed.maxPriorityFeePerGas.toString(16), accessList: signed.accessList, r: signed.signature.r, s: signed.signature.s, yParity: '0x' + signed.signature.yParity.toString(16)},
    sourceNativeBalanceBefore: '1000000000000000000', sourceNativeBalanceAfter: (1000000000000000000n - fee).toString(),
    sourceUsdcBefore: fixture.request.amount, sourceUsdcAfter: '0'};
}
test('protected CLI recovers both Mayan source signatures from actual DPAPI without unlock credentials', t => {
  for (const fixture of sourceFixtures) {
    const h = setup(t, fixture);
    const result = h.call({action: 'recovery-record', fingerprint: fixture.request.fingerprint});
    assert.equal(result.ok, true, result.error);
    assert.equal(result.result.response.transactionHash, fixture.response.transactionHash);
    assert.equal(result.result.operation.state, 'signed');
    assert.equal(fs.existsSync(path.join(h.directory, 'source.unlock.dpapi')), false);
    const before = fs.readFileSync(path.join(h.directory, 'ledger.json'));
    const repeated = h.call({action: 'recovery-record', fingerprint: fixture.request.fingerprint});
    assert.equal(repeated.ok, true);
    assert.deepEqual(fs.readFileSync(path.join(h.directory, 'ledger.json')), before);
  }
});
test('protected CLI records source holds and rejects generic or source-only complete settlement', t => {
  for (const fixture of sourceFixtures) {
    const h = setup(t, fixture, 'submitting');
    h.operation.transactionHash = fixture.response.transactionHash;
    h.write('ledger.json', {operations: [h.operation], permissions: []});
    const observations = ['https://one.example', 'https://two.example'].map(endpoint => ({endpoint, observedAt: Date.now(), result: structuredClone(sourceObservation(fixture))}));
    const held = h.call({action: 'record-mayan-source', fixtureOnly: true, synthetic: true, fingerprint: fixture.request.fingerprint, observations});
    assert.equal(held.ok, true, held.error);
    assert.equal(held.result.state, 'bridge-destination-pending');
    assert.equal(held.result.actualUsdMicros, undefined);
    assert.equal(held.result.reservedUsdMicros, '5000000');
    const before = fs.readFileSync(path.join(h.directory, 'ledger.json'));
    assert.equal(h.call({action: 'record-mayan-source', fixtureOnly: true, synthetic: true, fingerprint: fixture.request.fingerprint, observations}).ok, true);
    assert.equal(h.call({action: 'record-settlement', fingerprint: fixture.request.fingerprint, observations}).ok, false);
    assert.equal(h.call({action: 'record-mayan-route', fixtureOnly: true, synthetic: true, fingerprint: fixture.request.fingerprint, sourceObservations: observations, destinationObservations: observations}).ok, false);
    assert.deepEqual(fs.readFileSync(path.join(h.directory, 'ledger.json')), before);
  }
});
test('protected CLI recovers the separate destination response without altering its source identity', t => {
  const fixture = requireCandidate('./tests/fixtures/mayan-evm-redeem-local.json');
  const h = setup(t, {request: fixture.request.sourceRequest, response: fixture.request.sourceResponse}, 'bridge-destination-pending');
  h.operation.transactionHash = fixture.request.sourceResponse.transactionHash;
  const manifest = {fixtureOnly: true, request: fixture.request, parentFingerprint: h.operation.fingerprint, parentManifestHash: h.operation.manifestHash};
  h.operation.destination = {fingerprint: fixture.request.fingerprint, manifestHash: digest(manifest), state: 'reserved'};
  h.write('ledger.json', {operations: [h.operation], permissions: []});
  h.write(fixture.request.fingerprint.slice(2) + '.manifest.json', manifest);
  fs.writeFileSync(path.join(h.directory, fixture.request.fingerprint.slice(2) + '.response.dpapi'), dpapi('protect', Buffer.from(JSON.stringify(fixture.response))));
  const recovered = h.call({action: 'recover-mayan-destination', fingerprint: fixture.request.fingerprint});
  assert.equal(recovered.ok, true, recovered.error);
  assert.equal(recovered.result.response.transactionHash, fixture.response.transactionHash);
  assert.equal(recovered.result.networkBroadcastAllowed, false);
  assert.equal(recovered.result.operation.state, 'signed');
  const ledger = JSON.parse(fs.readFileSync(path.join(h.directory, 'ledger.json')));
  assert.equal(ledger.operations[0].fingerprint, h.operation.fingerprint);
  assert.equal(ledger.operations[0].transactionHash, fixture.request.sourceResponse.transactionHash);
  assert.equal(ledger.operations[0].reservedUsdMicros, '5000000');
  const before = fs.readFileSync(path.join(h.directory, 'ledger.json'));
  assert.equal(h.call({action: 'recover-mayan-destination', fingerprint: fixture.request.fingerprint}).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(h.directory, 'ledger.json')), before);
});
test('protected CLI settles bridge approval with bridge valuations and preserves consumed permissions on replay', t => {
  const h = setup(t, sourceFixtures[0], 'submitting');
  const source = sourceFixtures[0].request.from;
  const token = new Interface(['function approve(address,uint256)']);
  const request = {version: 22, chain: 'ethereum', network: 'ethereum', action: 'approve', asset: 'USDC', from: source, amount: '10000', maximumFee: '60000',
    unsignedTransaction: Transaction.from({type: 2, chainId: 1, nonce: 0, to: CHAINS.ethereum.usdc, gasLimit: 60000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, data: token.encodeFunctionData('approve', [MAYAN_EVM_PINS.diamond.address, 10000n])}).unsignedSerialized};
  h.manifest.request = request;
  h.operation.kind = 'bridge-allowance';
  h.operation.permission = {spender: MAYAN_EVM_PINS.diamond.address, amount: request.amount, revocation: false};
  h.operation.routeId = 'synthetic-mayan';
  h.operation.transactionHash = '0x' + '5'.repeat(64);
  h.operation.manifestHash = digest(h.manifest);
  h.write(h.operation.fingerprint.slice(2) + '.manifest.json', h.manifest);
  h.write('ledger.json', {operations: [h.operation], permissions: []});
  const receipt = {transactionHash: h.operation.transactionHash, status: '0x1', from: source, to: CHAINS.ethereum.usdc, blockHash: '0x' + '6'.repeat(64), gasUsed: '0x5208', effectiveGasPrice: '0x1'};
  const observations = ['https://one.example', 'https://two.example'].map(endpoint => ({endpoint, state: 'confirmed', transactionHash: h.operation.transactionHash, receipt, allowance: request.amount}));
  const settled = h.call({action: 'record-settlement', fingerprint: h.operation.fingerprint, observations});
  assert.equal(settled.ok, true, settled.error);
  assert.equal(settled.result.actualUsdMicros, '1');
  const ledger = JSON.parse(fs.readFileSync(path.join(h.directory, 'ledger.json')));
  assert.equal(ledger.permissions.length, 1);
  ledger.permissions = [];
  h.write('ledger.json', ledger);
  const before = fs.readFileSync(path.join(h.directory, 'ledger.json'));
  assert.equal(h.call({action: 'record-settlement', fingerprint: h.operation.fingerprint, observations}).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(h.directory, 'ledger.json')), before);
});
