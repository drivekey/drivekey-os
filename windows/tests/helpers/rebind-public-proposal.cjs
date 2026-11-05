'use strict';
// Fixture setup only. No keys or signatures are copied from the quote identity.
const {PublicKey, VersionedTransaction} = require('@solana/web3.js');
const {getAssociatedTokenAddressSync, NATIVE_MINT} = require('@solana/spl-token');
const {inspectLifiSolana, resolveLifiSolana, SOLANA_LIFI} = require('../../dist/lifi-solana-inspect.cjs');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function rebindPublicProposal(selected, target) {
  const proposal = selected.proposal;
  const source = proposal.bounds.from;
  if (proposal.bounds.recipient !== source || source === target || !PublicKey.isOnCurve(new PublicKey(target).toBytes())) throw Error('Invalid fixture quote identity');
  const checked = inspectLifiSolana(proposal.unsignedTransaction, proposal.lookupTables, proposal.bounds);
  const replacements = new Map([[source, target]]);
  for (const mint of [NATIVE_MINT.toBase58(), USDC, SOLANA_LIFI.intermediateMint]) {
    replacements.set(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(source)).toBase58(), getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(target)).toBase58());
  }
  checked.message.payerKey = new PublicKey(target);
  for (const instruction of checked.message.instructions) {
    for (const account of instruction.keys) {
      const replacement = replacements.get(account.pubkey.toBase58());
      if (replacement) account.pubkey = new PublicKey(replacement);
    }
  }
  const rebound = {
    bounds: {...proposal.bounds, from: target, recipient: target},
    unsignedTransaction: Buffer.from(new VersionedTransaction(checked.message.compileToV0Message(checked.tables)).serialize()).toString('base64'),
    lookupTables: proposal.lookupTables,
  };
  inspectLifiSolana(rebound.unsignedTransaction, rebound.lookupTables, rebound.bounds);
  return {...selected, proposal: rebound, resolved: resolveLifiSolana(rebound.unsignedTransaction, rebound.lookupTables), fixtureIdentityRebound: true};
}
module.exports = {rebindPublicProposal};
