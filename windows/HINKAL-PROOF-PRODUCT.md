# Native private-proof authorization

This implementation is an incomplete part of the full product. Production
`privateProofCreation` and the new import/review/authorize/export IPCs remain
disabled. Local cryptography, synthetic controller dialogs and unsigned native
worker checks do not qualify mainnet execution or release.

The v28 product request has a distinct fingerprint domain. It binds the full
public wallet, device, chain, exact circuit job, expected spending public key,
creation time and expiry. Legacy circuit formats and signatures retain their
original domains and historical meaning. A legacy circuit response is not a
product response. Networked preparation must supply a validated job without
spending or viewing secrets or speculative pending leaves.

The offline authorizer reconstructs the job using the existing isolated
circuit authorizers. A second wallet signature binds the exact product request
and circuit authorization. Monotonic elapsed time is checked across unlock and
signing. This authorization does not sign a blockchain transaction, generate a
SNARK, broadcast, or prove settlement. The final chain request must pass
`verifyProductProofChainLink` and a separate transaction review and approval.

The desktop controller requires the selected local vault and a verified
separate encrypted backup. It consumes the exact review token before native
approval. Invalidation during an awaited operation aborts export or signing;
an authorization already produced by the child is saved under the original
wallet before reporting cancellation. The encrypted immutable response is
persisted before any export picker. Restart/re-export reuses the same response.
The renderer receives review fields and history metadata only.

`proof-requests-v1` and `proofs-v1` participate in the same missing-key,
damaged-record and interrupted-write preservation scan as transaction and
signature history. Losing or mismatching a key must never provision a new key
over these records.

Remaining integration includes narrowly scoped private-view discovery and job
preparation, integrity-bound proving artifacts and genuine proving/finalization,
admission of the linked chain request, and independent note/proof settlement
and restart reconciliation. Ethereum and Solana cases still need their real
native approvals, separate-device exchange and intended-mainnet qualification
on the final identity-bound release. None of these requirements is waived.

Focused local checks:

```
node --require ./tests/offline-network-deny.cjs --test tests/product-proof.test.cjs tests/native-product-proof.test.cjs
node tests/ui/renderer-suite.cjs --filter=product-private-proof-review-and-recovery
```

The cryptographic fixture creates a fresh unfunded wallet and owned encrypted
note with a synthetic witness. Its secrets are never printed or packaged. The
controller tests explicitly substitute dialog answers; the renderer test uses a
finite synthetic preload. Neither exercises real native approval.
