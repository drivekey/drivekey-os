'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {transformSync} = require('esbuild');

// Exercise the actual signer control flow with synthetic buffers and SDK calls.
// No vault, real key, network, protected profile or chain transaction is used.
const file = path.resolve(__dirname, '../engine/offline-signer/hinkal-solana.ts');
const code = transformSync(fs.readFileSync(file, 'utf8'), {loader: 'ts', format: 'cjs'}).code;

async function runFault(fault) {
  const login = Buffer.alloc(64, 7);
  let loginCreated = false;
  let secretWiped = false;
  let signAttempted = false;
  let error;
  function failAt(stage) {
    if (fault === stage) throw Error('Synthetic failure at ' + stage);
  }
  class UserKeys {
    constructor() {failAt('constructor');}
    getShieldedPrivateKey() {failAt('nullifying-key'); return 1n;}
    getSpendingKeyPair() {failAt('spending-public-key'); return {pubSpendingBJJPoint: [1n, 2n]};}
    static getH1FromH0() {failAt('h1'); return [1n, 2n];}
    static getStealthAddress() {failAt('stealth'); return 3n;}
    static getEncryptionKeyPair() {failAt('encryption-key'); return {privateKey: 'synthetic', publicKey: '0xaaa'};}
  }
  const dependencies = {
    'tweetnacl': {sign: {detached: () => {
      if (!loginCreated) {loginCreated = true; return login;}
      return Buffer.alloc(64, 9);
    }}},
    'bs58': {encode: () => 'synthetic'},
    '@solana/web3.js': {VersionedTransaction: {deserialize: () => ({
      sign() {signAttempted = true; failAt('chain-sign');},
      serialize: () => Buffer.alloc(1), signatures: [Buffer.alloc(64)],
    })}},
    './multi-vault': {unlockMultiVault: async () => ({sol: {}})},
    './sol-secret': {
      retainedSolSecret: () => Buffer.alloc(64),
      wipeSolSecret: () => {secretWiped = true;},
    },
    '../core/hinkal-intent': {HINKAL_PIN: {sdkLoginMessage: 'synthetic'}},
    '../core/hinkal-solana-intent': {
      validateHinkalSolana: request => request,
      assertHinkalSolanaWallet() {},
      inspectHinkalSolana: () => {
        failAt('inspect');
        return {shape: {H0: [1n, 2n], H1: [1n, 2n], stealthAddress: 3n}, encryptedBlob: Buffer.alloc(64)};
      },
      hinkalSolanaApproval: () => Buffer.alloc(1),
      verifyHinkalSolanaResponse: response => {failAt('response-verification'); return response;},
    },
  };
  function requireMock(id) {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id.endsWith('/preProcessing.cjs')) return {preProcessing: async () => {failAt('preprocessing');}};
    if (id.endsWith('/keys.cjs')) return {UserKeys};
    if (id.endsWith('/ecdh-sealed-keys.cjs')) return {decryptSealedKeys: () => {
      failAt('decrypt');
      return Buffer.from(fault === 'invalid-plaintext' ? 'bad' : '0xaaa0x3');
    }};
    throw Error('Unexpected signer dependency ' + id);
  }
  const module = {exports: {}};
  vm.runInNewContext(code, {module, exports: module.exports, require: requireMock, Buffer, performance, Date});
  try {
    await module.exports.signHinkalSolana({}, 'synthetic', {fingerprint: 'synthetic', unsignedTransaction: 'AA=='}, 'synthetic');
  } catch (failure) {error = failure;}
  return {loginCreated, loginWiped: login.every(value => value === 0), secretWiped, signAttempted, error};
}

for (const fault of ['preprocessing', 'inspect', 'constructor', 'nullifying-key', 'h1', 'spending-public-key', 'stealth', 'encryption-key', 'decrypt', 'invalid-plaintext', 'chain-sign', 'response-verification', 'none']) {
  test('Hinkal login buffer cleanup at ' + fault, async () => {
    const result = await runFault(fault);
    assert.equal(result.secretWiped, true, 'retained Solana secret must be wiped');
    assert.equal(result.loginCreated, !['preprocessing', 'inspect'].includes(fault));
    if (result.loginCreated) assert.equal(result.loginWiped, true, 'temporary login signature must be wiped');
    assert.equal(result.signAttempted, ['chain-sign', 'response-verification', 'none'].includes(fault));
    assert.equal(Boolean(result.error), fault !== 'none');
  });
}
