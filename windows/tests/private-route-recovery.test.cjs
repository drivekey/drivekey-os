'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fixture = require('./fixtures/hinkal-solana-swap.json');
const {validateHinkalLocalSolanaSwapSeed, hinkalLocalSolanaSwapFingerprint} = require('../dist/hinkal-local-solana-swap.cjs');
const {validateHinkalSolanaSwap, verifyHinkalSolanaSwapResponse} = require('../dist/hinkal-solana-swap.cjs');
const {historicalReview} = require('../ui-routes-main.cjs');
const {CHAINS} = require('../dist/payment.cjs');

test('new private proofs reject unqualified venues in both early and late-bound seeds', () => {
  const early = fixture.request.proofSeed;
  const late = structuredClone(early);
  late.version = 27;
  delete late.chainContext;
  late.blockhashBinding = 'at-chain-signing';
  late.genesisHash = CHAINS.solana.genesis;
  late.fingerprint = hinkalLocalSolanaSwapFingerprint(late);
  for (const seed of [early, late]) {
    assert.throws(() => validateHinkalLocalSolanaSwapSeed(seed, Date.parse(seed.createdAt)), /not qualified/);
    assert.doesNotThrow(() => validateHinkalLocalSolanaSwapSeed(seed, Date.parse(seed.createdAt), false));
  }
  assert.throws(() => validateHinkalSolanaSwap(fixture.request, Date.parse(fixture.response.signedAt)), /not qualified/);
});

test('historical unqualified route retains exact signed recovery without decrypting a vault', () => {
  const request = fixture.request;
  const wallet = {version: 3, deviceId: request.deviceId, createdAt: request.createdAt, evmAddress: '0x' + '1'.repeat(40), solanaAddress: request.from};
  const vault = {version: 3, kind: 'drivekey-multi-vault', public: wallet, kdf: 'scrypt-131072-8-1', salt: '0'.repeat(64), iv: '0'.repeat(24), ciphertext: '0'.repeat(128), tag: '0'.repeat(32)};
  const recovered = verifyHinkalSolanaSwapResponse(fixture.response, request, wallet, Date.now(), false);
  assert.equal(recovered.rawSignedTransaction, fixture.response.rawSignedTransaction);
  assert.equal(historicalReview(request, () => undefined).fingerprint, request.fingerprint);
  const worker = spawnSync(process.execPath, ['--no-addons', '--require', './tests/offline-network-deny.cjs', 'dist/worker.cjs'], {input: JSON.stringify({action: 'verify-saved', vault, request, response: fixture.response}), encoding: 'utf8', windowsHide: true});
  assert.equal(worker.status, 0);
  const result = JSON.parse(worker.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.result.response.transactionHash, fixture.response.transactionHash);
  assert.equal(result.result.response.rawSignedTransaction, fixture.response.rawSignedTransaction);
});
