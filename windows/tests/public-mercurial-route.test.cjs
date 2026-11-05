'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PublicKey, VersionedTransaction} = require('@solana/web3.js');
const {inspectLifiSolana, resolveLifiSolana, SOLANA_LIFI} = require('../dist/lifi-solana-inspect.cjs');
const {assertHinkalSolanaRouteQualified} = require('../dist/hinkal-solana-swap-proposal.cjs');
const fixture = require('./fixtures/lifi-mercurial-solana.json');

test('public Mercurial route retains exact Jupiter shared authority and minimum output', () => {
  const result = inspectLifiSolana(fixture.unsignedTransaction, fixture.lookupTables, fixture.bounds);
  assert.equal(result.review.routeVariant, 'shared_accounts_route_v2');
  assert.deepEqual(result.review.ammPrograms, [SOLANA_LIFI.amms.RaydiumClmm, SOLANA_LIFI.amms.Mercurial]);
  assert.equal(result.review.minimumOutput, fixture.bounds.minimumOutput);
  assert.equal(result.review.recipient, fixture.bounds.recipient);
  assert.throws(() => assertHinkalSolanaRouteQualified(result.review), /not qualified/);
});

test('public Mercurial admission cannot substitute another executable or writable program', () => {
  for (const alter of [
    key => { key.pubkey = new PublicKey(Buffer.alloc(32, 23)); },
    key => { key.isWritable = true; },
  ]) {
    const resolved = resolveLifiSolana(fixture.unsignedTransaction, fixture.lookupTables);
    const instruction = resolved.message.instructions.find(item => item.programId.toBase58() === SOLANA_LIFI.jupiter);
    const key = instruction.keys.find(item => item.pubkey.toBase58() === SOLANA_LIFI.amms.Mercurial);
    assert.ok(key);
    alter(key);
    const serialized = Buffer.from(new VersionedTransaction(resolved.message.compileToV0Message(resolved.tables)).serialize()).toString('base64');
    assert.throws(() => inspectLifiSolana(serialized, fixture.lookupTables, fixture.bounds));
  }
});
