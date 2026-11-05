'use strict';
// All observations in this file are synthetic, with no network or signing.
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const requireCandidate = Module.createRequire(path.join(root, 'package.json'));
const {bridgeSourceCost, holdBridgeSource, bridgeRouteCost} = require('../tools/bridge-settlement-cost.cjs');
const {Transaction} = requireCandidate('ethers');
const {PublicKey} = requireCandidate('@solana/web3.js');
const sourceSol = requireCandidate('./tests/fixtures/mayan-solana-source.json');
const sourceEvm = requireCandidate('./tests/fixtures/lifi-mayan-evm-source.json');
const redeem = requireCandidate('./tests/fixtures/mayan-evm-redeem-local.json');
const valuation = {usdcUsdMicros: '1000000', ethereumUsdMicros: '3000000000', solanaUsdMicros: '100000000'};
const clone = value => structuredClone(value);
function observations(result) {
  return ['https://one.example/rpc', 'https://two.example/rpc'].map(endpoint => ({endpoint, observedAt: Date.now(), result: clone(result)}));
}
function ethereumProof(receipt, response) {
  const transaction = Transaction.from(response.rawSignedTransaction);
  return {
    receipt: clone(receipt), finalityVerified: true,
    canonicalBlock: {hash: receipt.blockHash, number: receipt.blockNumber, parentHash: '0x' + '1'.repeat(64), transactions: [receipt.transactionHash]},
    previousBlock: {hash: '0x' + '1'.repeat(64), number: '0x' + (BigInt(receipt.blockNumber) - 1n).toString(16)},
    finalizedBlock: {number: receipt.blockNumber},
    observedTransaction: {type: '0x2', hash: transaction.hash, blockHash: receipt.blockHash, from: transaction.from, to: transaction.to, input: transaction.data,
      value: '0x' + transaction.value.toString(16), nonce: '0x' + BigInt(transaction.nonce).toString(16), chainId: '0x1',
      gas: '0x' + transaction.gasLimit.toString(16), maxFeePerGas: '0x' + transaction.maxFeePerGas.toString(16),
      maxPriorityFeePerGas: '0x' + transaction.maxPriorityFeePerGas.toString(16), accessList: transaction.accessList,
      r: transaction.signature.r, s: transaction.signature.s, yParity: '0x' + transaction.signature.yParity.toString(16)},
    sourceNativeBalanceBefore: '1000000000000000000',
    sourceNativeBalanceAfter: (1000000000000000000n - BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString(),
  };
}
function solanaProof(fixture = sourceSol) {
  return {sourceState: 'confirmed', receipt: clone(fixture.receipt), messageAccount: clone(fixture.messageAccount), messageAccountContextSlot: fixture.receipt.slot,
    finalityVerified: true, finalizedStatus: {confirmationStatus: 'finalized', err: null, slot: fixture.receipt.slot}};
}
test('staged source accounting charges gross temporary Solana funding and keeps the parent held', () => {
  const values = observations(solanaProof());
  const actual = bridgeSourceCost(sourceSol.request, sourceSol.response, values, valuation);
  assert.equal(actual.actualGrossAccountFundingBaseUnits, '6624320');
  assert.equal(actual.actualSourceUsdMicros, '1163432');
  const held = holdBridgeSource({kind: 'bridge', state: 'submitting', sourceMaximumUsdMicros: '1600000', reservedUsdMicros: '1900000'}, actual);
  assert.equal(held.actualUsdMicros, undefined);
  assert.equal(held.reservedUsdMicros, '1900000');
  assert.equal(held.state, 'bridge-destination-pending');
  assert.deepEqual(holdBridgeSource(held, actual), held);
});
test('staged Ethereum source accounting enforces zero allowance and canonical native/token debits', () => {
  const value = {...ethereumProof(sourceEvm.receipt, sourceEvm.response), sourceState: 'confirmed', allowance: '0', sourceUsdcBefore: sourceEvm.request.amount, sourceUsdcAfter: '0'};
  const actual = bridgeSourceCost(sourceEvm.request, sourceEvm.response, observations(value), valuation);
  assert.equal(actual.sourceMessage, sourceEvm.sourceMessage);
  for (const change of [x => x.allowance = '1', x => x.sourceUsdcAfter = '1', x => x.sourceNativeBalanceAfter = '0', x => x.finalizedBlock.number = '0x0', x => x.canonicalBlock.transactions = [], x => x.observedTransaction.input = '0x',
    x => x.observedTransaction.r = '0x' + '1'.repeat(64),
    x => x.observedTransaction.gas = '0xffffffffffff',
    x => {x.receipt.gasUsed = '0xffffffffffff'; x.receipt.effectiveGasPrice = '0x0';},
    x => {x.receipt.gasUsed = '0x1'; x.receipt.effectiveGasPrice = '0xffffffffffff';}]) {
    const altered = clone(value); change(altered);
    assert.throws(() => bridgeSourceCost(sourceEvm.request, sourceEvm.response, observations(altered), valuation));
  }
});
test('staged source evidence rejects stale, same-host, altered-slot and message substitutions', () => {
  for (const change of [x => x[0].observedAt -= 120001, x => x[1].endpoint = x[0].endpoint, x => x[0].result.finalizedStatus.slot++, x => x[1].result.messageAccountContextSlot = 0, x => x[0].result.messageAccount.owner = sourceSol.request.from]) {
    const values = observations(solanaProof()); change(values);
    assert.throws(() => bridgeSourceCost(sourceSol.request, sourceSol.response, values, valuation));
  }
  const actual = bridgeSourceCost(sourceSol.request, sourceSol.response, observations(solanaProof()), valuation);
  assert.throws(() => holdBridgeSource({kind: 'bridge', state: 'submitting', sourceMaximumUsdMicros: '1', reservedUsdMicros: '1900000'}, actual));
  assert.throws(() => holdBridgeSource({kind: 'bridge', state: 'settled', sourceMaximumUsdMicros: '1900000', reservedUsdMicros: '1900000'}, actual));
});
test('staged self-redemption binds the exact parent source and adds destination gas without reducing gross debit', async () => {
  const source = clone(sourceSol);
  source.request = redeem.request.sourceRequest;
  source.response = redeem.request.sourceResponse;
  source.receipt.transaction[0] = source.response.rawSignedTransaction;
  source.receipt.slot = redeem.request.sourceSlot;
  const {inspectMayanSolanaWire} = requireCandidate('./dist/mayan-solana-wire.cjs');
  const before = inspectMayanSolanaWire(sourceSol.request.unsignedTransaction, sourceSol.request);
  const after = inspectMayanSolanaWire(source.request.unsignedTransaction, source.request);
  const addresses = new Map([[sourceSol.request.from, source.request.from], [sourceSol.request.auxiliary, source.request.auxiliary]]);
  for (const [name, address] of Object.entries(before.accounts)) addresses.set(address, after.accounts[name]);
  const indices = before.keys.map(address => after.keys.indexOf(addresses.get(address) || address));
  assert.ok(indices.every(index => index >= 0));
  for (const field of ['preBalances', 'postBalances']) {
    const reordered = [];
    source.receipt.meta[field].forEach((value, index) => {reordered[indices[index]] = value;});
    source.receipt.meta[field] = reordered;
  }
  for (const group of source.receipt.meta.innerInstructions) {
    for (const instruction of group.instructions) {
      instruction.programIdIndex = indices[instruction.programIdIndex];
      instruction.accounts = instruction.accounts.map(index => indices[index]);
    }
  }
  for (const list of [source.receipt.meta.preTokenBalances, source.receipt.meta.postTokenBalances]) {
    for (const balance of list) {
      balance.accountIndex = indices[balance.accountIndex];
      if (balance.owner === sourceSol.request.from) balance.owner = source.request.from;
    }
  }
  const account = Buffer.from(source.messageAccount.data[0], 'base64');
  new PublicKey(source.request.from).toBuffer().copy(account, 8);
  Buffer.from(redeem.request.sourceMessage.slice(2), 'hex').copy(account, 52);
  source.messageAccount.data[0] = account.toString('base64');
  const sourceObservations = observations(solanaProof(source));
  const destination = {...ethereumProof(redeem.receipt, redeem.response), state: 'confirmed', completeRoute: true, recipientBalanceBefore: '0', recipientBalanceAfter: redeem.expectedOutput};
  const args = {sourceRequest: source.request, sourceResponse: source.response, sourceObservations, sourceValuation: valuation, destinationRequest: redeem.request, destinationResponse: redeem.response, destinationObservations: observations(destination), destinationValuation: valuation};
  const actual = await bridgeRouteCost(args);
  assert.equal(actual.output, redeem.expectedOutput);
  assert.equal(actual.completeRoute, true);
  assert.equal(BigInt(actual.actualUsdMicros), BigInt(actual.actualSourceUsdMicros) + BigInt(actual.actualDestinationUsdMicros));
  const changed = clone(args); changed.destinationRequest.sourceSlot++;
  await assert.rejects(() => bridgeRouteCost(changed));
  const changedGas = clone(args); changedGas.destinationObservations[0].result.sourceNativeBalanceAfter = '1';
  await assert.rejects(() => bridgeRouteCost(changedGas));
});
