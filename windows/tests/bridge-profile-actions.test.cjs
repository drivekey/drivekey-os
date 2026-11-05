'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireCandidate = Module.createRequire(path.join(root, 'package.json'));
const {setup} = require('./helpers/mayan-destination-policy-fixture.cjs');
const {bridgeCodec} = requireCandidate('./tools/bridge-intent-codecs.cjs');
const fixture = requireCandidate('./tests/fixtures/mayan-evm-redeem-local.json');
const sourceFixture = requireCandidate('./tests/fixtures/mayan-solana-source.json');
const {MAYAN_SOLANA} = requireCandidate('./dist/mayan-solana-wire.cjs');
const {CHAINS} = requireCandidate('./dist/payment.cjs');
const {handleBridgeAction} = require('../tools/bridge-profile-actions.cjs');
function removeFixture(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('drivekey-synthetic-bridge-')) throw Error('Fixture cleanup escaped its temporary root.');
  fs.rmSync(resolved, {recursive: true, force: true});
}
function harness(value, emptySource = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-synthetic-bridge-'));
  const write = (file, data) => fs.writeFileSync(file, data);
  const json = file => JSON.parse(fs.readFileSync(file));
  const source = path.join(dir, value.operation.fingerprint.slice(2));
  write(path.join(dir, 'ledger.json'), JSON.stringify(value.state));
  if (!emptySource) {
    write(source + '.manifest.json', JSON.stringify(value.sourceManifest));
    write(source + '.response.dpapi', JSON.stringify(value.sourceResponse));
  }
  write(path.join(dir, 'source.unlock.dpapi'), 'synthetic-test-password');
  write(path.join(dir, 'source.vault.json'), JSON.stringify({fixtureOnly: true}));
  let signCount = 0;
  const context = {dir, identity: {...value.identity, fixtureOnly: true}, lock: async () => async () => {}, json, write,
    // This in-memory crypto substitute belongs only to isolated synthetic tests.
    dpapi: (mode, bytes) => Buffer.from(bytes),
    qualifiedManifest: async manifest => {
      assert.equal(manifest.sourceFingerprint, value.identity.sourceFingerprint);
      assert.deepEqual(manifest.binaryHashes, value.sourceManifest.binaryHashes);
    },
    assertEvidenceClass: manifest => assert.equal(manifest.fixtureOnly, true),
    verifySigned: (response, request, wallet, expiry = true) => bridgeCodec(request).verify(response, request, wallet, value.now, expiry),
    worker: job => {
      signCount++;
      assert.equal(job.action, 'sign');
      assert.equal(job.fingerprint, value.manifest.request.fingerprint);
      return structuredClone(emptySource ? sourceFixture.response : fixture.response);
    },
    persistSignedResponse: (base, response) => write(base + '.response.dpapi', JSON.stringify(response)),
  };
  const run = async job => {
    const originalNow = Date.now;
    Date.now = () => value.now;
    try {return await handleBridgeAction(job, context);} finally {Date.now = originalNow;}
  };
  return {dir, context, run, signCount: () => signCount, ledger: () => json(path.join(dir, 'ledger.json'))};
}
function setupSource() {
  const request = structuredClone(sourceFixture.request);
  const now = Date.parse(request.createdAt) + 1000;
  const sourceFingerprint = 'a'.repeat(64);
  const endpoints = ['https://one.example', 'https://two.example'];
  const identity = {sourceFingerprint, source: {deviceId: request.deviceId, solanaAddress: request.from, evmAddress: request.recipient}, usdc: {ethereum: CHAINS.ethereum.usdc, solana: CHAINS.solana.usdc}};
  const state = {sessionId: '8e6394cc-f233-49e1-b531-2fd56340bb16', sourceFingerprint, operations: [], permissions: []};
  const manifest = {version: 1, kind: 'disposable-bridge-source-authorization', sessionId: state.sessionId, sourceFingerprint,
    fixtureOnly: true, binaryHashes: {'worker.cjs': 'b'.repeat(64)}, request, routeId: 'mayan-solana-ethereum', requestFingerprint: request.fingerprint,
    source: request.from, destination: request.recipient, sourceChain: 'solana', destinationChain: 'ethereum',
    sourceChainId: 1151111081099710, destinationChainId: 1, inputTokenContract: CHAINS.solana.usdc, outputTokenContract: CHAINS.ethereum.usdc,
    exactInput: request.amount, minimumOutput: request.minimumOutput, slippageBps: request.slippageBps, maximumFee: request.maximumFee,
    accountRent: request.accountRent, destinationMaximumFee: request.destinationMaximumFee, deadline: request.expiresAt,
    blockhash: request.blockhash, lastValidBlockHeight: request.lastValidBlockHeight, auxiliary: request.auxiliary,
    spender: null, contractTarget: MAYAN_SOLANA.program, stopConditions: ['uncertain-broadcast', 'unverified-destination', 'stale-valuation'],
    valuation: {observedAt: now, sources: endpoints, usdcUsdMicros: '1000000', ethereumUsdMicros: '3000000000', solanaUsdMicros: '100000000', solanaLowerUsdMicros: '99000000'},
    simulation: {passed: true, fingerprint: request.fingerprint, observedAt: now, endpoints},
    destinationPreflight: {observedAt: now, endpoints, pinnedDeployment: true, attestersVerified: true, feeBoundVerified: true},
    routeEvidence: {provider: 'lifi', bridge: 'mayanFastMCTP', observedAt: now, sourceChain: 'solana', destinationChain: 'ethereum', inputTokenContract: CHAINS.solana.usdc, outputTokenContract: CHAINS.ethereum.usdc,
      destination: request.recipient, quoteHash: '0x' + 'c'.repeat(64), executionMode: 'self-redeem', executionRedeemFee: request.redeemFee, retailQuoteIsNotExecutionPromise: true},
    sourceNativeReserve: '3000000', sourceNativeBalance: '20000000', destinationNativeReserve: request.destinationMaximumFee, destinationNativeBalance: '1000000000000000000'};
  return {manifest, sourceManifest: manifest, operation: {fingerprint: request.fingerprint}, state, identity, now};
}
test('protected source persists one gross reservation and holds it after finalized burn', async () => {
  const value = setupSource();
  const h = harness(value, true);
  try {
    const signed = await h.run({action: 'sign-mayan-source', manifest: value.manifest});
    assert.equal(signed.transactionHash, sourceFixture.response.transactionHash);
    await assert.rejects(() => h.run({action: 'sign-mayan-source', manifest: value.manifest}));
    const state = h.ledger();
    state.operations[0].state = 'fixture-gate-consumed';
    fs.writeFileSync(path.join(h.dir, 'ledger.json'), JSON.stringify(state));
    const observations = ['https://one.example', 'https://two.example'].map(endpoint => ({endpoint, observedAt: value.now, result: {
      sourceState: 'confirmed', receipt: sourceFixture.receipt, messageAccount: sourceFixture.messageAccount,
      messageAccountContextSlot: sourceFixture.receipt.slot, finalityVerified: true,
      finalizedStatus: {confirmationStatus: 'finalized', err: null, slot: sourceFixture.receipt.slot}}}));
    const recorded = await h.run({action: 'record-mayan-source', fingerprint: signed.fingerprint, fixtureOnly: true, synthetic: true, observations});
    assert.equal(recorded.state, 'bridge-destination-pending');
    assert.equal(recorded.actualSourceUsdMicros, '1163432');
    assert.equal(recorded.actualUsdMicros, undefined);
    assert.equal(recorded.reservedUsdMicros, signed.reservedUsdMicros);
    const before = fs.readFileSync(path.join(h.dir, 'ledger.json'));
    await h.run({action: 'record-mayan-source', fingerprint: signed.fingerprint, fixtureOnly: true, synthetic: true, observations});
    assert.deepEqual(fs.readFileSync(path.join(h.dir, 'ledger.json')), before);
    assert.equal(h.signCount(), 1);
  } finally {removeFixture(h.dir);}
});
test('protected ambiguous source signing failure retains a reservation and denies another signature', async () => {
  const value = setupSource();
  const h = harness(value, true);
  h.context.worker = () => {throw Error('Synthetic worker failure.');};
  try {
    await assert.rejects(() => h.run({action: 'sign-mayan-source', manifest: value.manifest}));
    assert.equal(h.ledger().operations.length, 1);
    assert.equal(h.ledger().operations[0].state, 'reserved');
    assert.equal(h.ledger().operations[0].actualUsdMicros, undefined);
    await assert.rejects(() => h.run({action: 'sign-mayan-source', manifest: value.manifest}));
  } finally {removeFixture(h.dir);}
});
test('protected destination has one durable signature and one isolated submission gate', async () => {
  const value = setup();
  value.manifest.fixtureOnly = true;
  const h = harness(value);
  try {
    const result = await h.run({action: 'sign-mayan-destination', manifest: value.manifest});
    assert.equal(result.transactionHash, fixture.response.transactionHash);
    assert.equal(h.signCount(), 1);
    assert.equal(h.ledger().operations.length, 1);
    assert.equal(h.ledger().operations[0].reservedUsdMicros, value.operation.reservedUsdMicros);
    assert.equal(h.ledger().operations[0].actualUsdMicros, undefined);
    const recovered = await h.run({action: 'recover-mayan-destination', fingerprint: result.fingerprint});
    assert.equal(recovered.operation.state, 'signed');
    assert.equal(recovered.networkBroadcastAllowed, false);
    const gate = await h.run({action: 'take-fixture-mayan-destination-submission', fingerprint: result.fingerprint});
    assert.equal(gate.networkBroadcastAllowed, false);
    assert.equal(gate.operation.fixtureSubmissionAttempts, 1);
    await assert.rejects(() => h.run({action: 'take-fixture-mayan-destination-submission', fingerprint: result.fingerprint}));
    await assert.rejects(() => h.run({action: 'sign-mayan-destination', manifest: value.manifest}));
    assert.equal(h.signCount(), 1);
  } finally {removeFixture(h.dir);}
});
test('protected destination expiry preserves recovery while denying a new submission capability', async () => {
  const value = setup();
  value.manifest.fixtureOnly = true;
  const h = harness(value);
  try {
    await h.run({action: 'sign-mayan-destination', manifest: value.manifest});
    value.now = Date.parse(fixture.request.expiresAt) + 1;
    const recovered = await h.run({action: 'recover-mayan-destination', fingerprint: fixture.request.fingerprint});
    assert.equal(recovered.operation.state, 'signed');
    assert.equal(recovered.networkBroadcastAllowed, false);
    await assert.rejects(() => h.run({action: 'take-fixture-mayan-destination-submission', fingerprint: fixture.request.fingerprint}));
    assert.equal(h.ledger().operations[0].destination.state, 'signed');
    assert.equal(h.signCount(), 1);
  } finally {removeFixture(h.dir);}
});
test('protected destination preserves reservation across a response-persistence crash without re-signing', async () => {
  const value = setup();
  value.manifest.fixtureOnly = true;
  const h = harness(value);
  const persist = h.context.persistSignedResponse;
  h.context.persistSignedResponse = (...args) => {persist(...args); throw Error('Synthetic crash after durable response.');};
  try {
    await assert.rejects(() => h.run({action: 'sign-mayan-destination', manifest: value.manifest}));
    assert.equal(h.ledger().operations[0].destination.state, 'reserved');
    const recovered = await h.run({action: 'recover-mayan-destination', fingerprint: fixture.request.fingerprint});
    assert.equal(recovered.operation.state, 'signed');
    assert.equal(h.signCount(), 1);
    await assert.rejects(() => h.run({action: 'sign-mayan-destination', manifest: value.manifest}));
    assert.equal(h.signCount(), 1);
  } finally {removeFixture(h.dir);}
});
