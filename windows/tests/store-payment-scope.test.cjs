'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes, randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {Transaction, Wallet} = require('ethers');
const {Keypair} = require('@solana/web3.js');
const policy = require('../tools/store-payment-policy.cjs');
const {CHAINS, ERC20_PAYMENT, paymentFingerprint, solPayment, verifyPaymentResponse} = require('../dist/payment.cjs');

function worker(name, job) {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist', name)], {
    input: JSON.stringify(job), encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  assert.ifError(result.error);
  const reply = JSON.parse(result.stdout);
  assert.equal(result.status, reply.ok ? 0 : 1);
  return reply;
}

function fixture(chain, asset, wallet) {
  const {family, chainId, usdc} = CHAINS[chain];
  const solana = family === 'solana';
  const now = Date.now();
  const request = {
    version: 8, action: 'payment', deviceId: wallet.deviceId, requestId: randomUUID(), chain, network: family,
    from: solana ? wallet.solanaAddress : wallet.evmAddress,
    recipient: solana ? Keypair.generate().publicKey.toBase58() : Wallet.createRandom().address,
    asset, amount: '1000', maximumFee: solana ? '5000' : '120000', accountRent: '0', createRecipientAccount: false,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString(),
    blockhash: solana ? Keypair.generate().publicKey.toBase58() : null, lastValidBlockHeight: solana ? 1000 : null,
  };
  if (solana) {
    request.unsignedTransaction = solPayment(request).serialize({requireAllSignatures: false, verifySignatures: false}).toString('base64');
  } else {
    request.unsignedTransaction = Transaction.from({type: 2, chainId, nonce: 0, gasLimit: 60000,
      maxFeePerGas: 2, maxPriorityFeePerGas: 1, to: asset === 'USDC' ? usdc : request.recipient,
      value: asset === 'USDC' ? 0 : 1000,
      data: asset === 'USDC' ? ERC20_PAYMENT.encodeFunctionData('transfer', [request.recipient, 1000]) : '0x',
    }).unsignedSerialized;
  }
  request.fingerprint = paymentFingerprint(request);
  return request;
}

test('the Store worker signs exact ETH, SOL and USDC payments on the supported chains with disposable local keys', () => {
  const password = randomBytes(32).toString('hex');
  const {result: vault} = worker('worker.cjs', {action: 'create', password});
  assert.ok(vault?.public);
  for (const [chain, asset] of [['ethereum','ETH'], ['ethereum','USDC'], ['solana','SOL'], ['solana','USDC'], ['sepolia','ETH'], ['sepolia','USDC'], ['devnet','SOL'], ['devnet','USDC']]) {
    const request = fixture(chain, asset, vault.public);
    const signed = worker('worker.cjs', {action:'sign', password, vault, request, fingerprint:request.fingerprint});
    assert.equal(signed.ok, true, `${chain} ${asset} fixture should sign.`);
    assert.equal(verifyPaymentResponse(signed.result, request, vault.public).transactionHash, signed.result.transactionHash);
  }
});

test('deferred prepare, sign and broadcast paths are closed while reconciliation remains available', () => {
  const deferred = ['uniswap-v3', 'lifi-evm', 'lifi-solana', 'lifi-relay-source', 'lifi-mayan-evm-source',
    'mayan-evm-redeem', 'mayan-solana-source', 'hinkal-direct', 'hinkal-solana', 'hinkal-solana-spend',
    'hinkal-evm-swap', 'hinkal-solana-swap'];
  for (const prefix of deferred) {
    assert.doesNotThrow(() => policy.assertOnlineJob({action:`${prefix}-reconcile`}));
    for (const suffix of ['prepare','preflight','broadcast']) {
      const job = {action:`${prefix}-${suffix}`, endpoints:{}};
      assert.throws(() => policy.assertOnlineJob(job), /direct ETH/);
      assert.equal(worker('online-worker.cjs', job).ok, false);
    }
  }
  for (const channel of ['prepare-swap', 'prepare-lifi-solana', 'import-prepared-bridge', 'import-prepared-private', 'hinkal-discover']) {
    assert.throws(() => policy.assertIpcChannel(channel), /direct ETH/);
  }
  for (const action of ['sign-swap','sign-hinkal','sign-proof-job','sign-local-swap']) {
    assert.equal(worker('worker.cjs', {action}).ok, false);
  }
  for (const request of [{version:9, action:'swap', chain:'ethereum', network:'ethereum', asset:'ETH'},
    {version:8, action:'payment', chain:'solana', network:'ethereum', asset:'SOL'},
    {version:8, action:'payment', chain:'ethereum', network:'ethereum', asset:'SOL'}]) {
    assert.throws(() => policy.assertIntent(request), /direct ETH/);
    assert.equal(worker('online-worker.cjs', {action:'broadcast', endpoints:{}, request}).ok, false);
  }
});
