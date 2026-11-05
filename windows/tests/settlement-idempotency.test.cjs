'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {Transaction, Interface} = require('ethers');
const {digest} = require('../tools/acceptance-policy.cjs');

test('replaying settled Ethereum approval evidence cannot restore a consumed permission', t => {
  const root = path.resolve(__dirname, '..');
  const parent = path.join(process.env.LOCALAPPDATA, 'DriveKeyAcceptance');
  const sessionId = randomUUID();
  const directory = path.join(parent, sessionId);
  fs.mkdirSync(directory, {recursive: true});
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(parent));
    assert.equal(fs.realpathSync(directory).toLowerCase(), path.resolve(directory).toLowerCase());
    fs.rmSync(directory, {recursive: true, force: true});
  });
  const from = '0x1111111111111111111111111111111111111111';
  const token = '0x2222222222222222222222222222222222222222';
  const spender = '0x3333333333333333333333333333333333333333';
  const fingerprint = '0x' + '4'.repeat(64);
  const transactionHash = '0x' + '5'.repeat(64);
  const iface = new Interface(['function approve(address spender,uint256 amount)']);
  const request = {
    version: 9, action: 'approve', chain: 'ethereum', network: 'ethereum', from,
    tokenIn: 'USDC', amount: '100000', maximumFee: '21000',
    unsignedTransaction: Transaction.from({type: 2, chainId: 1, nonce: 0, to: token, data: iface.encodeFunctionData('approve', [spender, 100000n]), gasLimit: 21000, maxFeePerGas: 1, maxPriorityFeePerGas: 1}).unsignedSerialized,
  };
  const manifest = {request, valuation: {assetUsdMicros: '1000000', nativeUsdMicros: '1000000'}};
  const receipt = {transactionHash, status: '0x1', from, to: token, blockHash: '0x' + '6'.repeat(64), gasUsed: '0x5208', effectiveGasPrice: '0x1'};
  const observations = ['https://one.example', 'https://two.example'].map(endpoint => ({endpoint, state: 'confirmed', transactionHash, receipt: {...receipt}, allowance: request.amount}));
  const operation = {fingerprint, state: 'settled', transactionHash, manifestHash: digest(manifest), routeId: 'fixture-route', reservedUsdMicros: '10', actualUsdMicros: '1', actualFeeBaseUnits: '21000', permission: {spender, revocation: false}, finality: observations, settledAt: '2026-01-01T00:00:00.000Z'};
  const ledger = {operations: [operation], permissions: []};
  const ledgerFile = path.join(directory, 'ledger.json');
  fs.writeFileSync(path.join(directory, 'public.json'), JSON.stringify({fixtureOnly: true}));
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger));
  fs.writeFileSync(path.join(directory, fingerprint.slice(2) + '.manifest.json'), JSON.stringify(manifest));
  const call = values => {
    const result = spawnSync(process.execPath, [path.join(root, 'tools/protected-test-profile.cjs')], {input: JSON.stringify({action: 'record-settlement', sessionId, fingerprint, observations: values}), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024});
    return {code: result.status, response: JSON.parse(result.stdout)};
  };
  const initial = fs.readFileSync(ledgerFile, 'utf8');
  const repeated = call(observations);
  assert.equal(repeated.code, 0);
  assert.equal(repeated.response.ok, true);
  assert.deepEqual(repeated.response.result, operation);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), initial);
  const changedBlock = structuredClone(observations);
  for (const value of changedBlock) value.receipt.blockHash = '0x' + '7'.repeat(64);
  assert.equal(call(changedBlock).response.ok, false);
  const changedAllowance = structuredClone(observations);
  for (const value of changedAllowance) value.allowance = '0';
  assert.equal(call(changedAllowance).response.ok, false);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), initial);
});
