'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Keypair} = require('@solana/web3.js');
const {fixture, serialize} = require('./helpers/lifi-solana-fixture.cjs');
const {rebindPublicProposal} = require('./helpers/rebind-public-proposal.cjs');
const {inspectLifiSolana} = require('../dist/lifi-solana-inspect.cjs');

test('VM fixture rebinding preserves economic terms and changes only the controlled actor', () => {
  const original = fixture();
  const selected = {proposal: {bounds: original.r, unsignedTransaction: serialize(original), lookupTables: original.snapshots}};
  const target = Keypair.generate().publicKey.toBase58();
  const rebound = rebindPublicProposal(selected, target);
  const review = inspectLifiSolana(rebound.proposal.unsignedTransaction, rebound.proposal.lookupTables, rebound.proposal.bounds).review;
  assert.equal(review.from, target);
  assert.equal(review.recipient, target);
  assert.equal(review.amount, original.r.amount);
  assert.equal(review.minimumOutput, original.r.minimumOutput);
  assert.equal(review.protocolFee, original.r.protocolFee);
  assert.equal(selected.proposal.bounds.from, original.r.from);
  assert.equal(selected.proposal.unsignedTransaction, serialize(original));
  assert.throws(() => rebindPublicProposal(selected, original.r.from));
  assert.throws(() => rebindPublicProposal({proposal: {...selected.proposal, bounds: {...original.r, recipient: target}}}, target));
});
