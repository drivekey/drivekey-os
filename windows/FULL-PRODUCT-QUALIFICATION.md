# Full product qualification

The intended release includes all 24 original payment, Uniswap, LI.FI, Hinkal and merchant cases. The payments-only Store policy is an incomplete candidate. Passing `check:store` does not qualify the full product. Preserve its results as scoped local evidence.

Run `pnpm check:full-product path/to/manifest.json` to audit a version 1 full-product evidence manifest. The manifest must have `schemaVersion: 1`, `release`, `cases`, `gates` and `accounting`. The authoritative finite case and gate identifiers are exported by `tools/full-product-gates.cjs`; no case may be skipped, duplicated or silently removed.

`release` contains `sourceFingerprint` and six `artifacts`: `windowsExe`, `windowsAsar`, `windowsMsix`, `companionExe`, `companionAsar`, `companionZip`. Each artifact contains a relative `path` and `sha256`. Keep the manifest at the root of its evidence directory. Paths must stay within that directory and cannot traverse symlinks or junctions. The CLI rehashes actual files; it never opens a signer. Internal evidence directories are not upload bundles.

Each case must identify the exact package-pair `releaseDigest`, have status `passed`, evidence level `installed-mainnet`, network `mainnet`, canonical transaction hashes, hash-bound evidence files and all required lifecycle assertions. Bridge destination confirmation, Hinkal genuine proofs/note state, recipient token-account creation/rent and invoice uniqueness receive separate checks. Supporting evidence must establish each assertion; the audit does not independently authenticate a reviewer's identity or query chain settlement.

Each release gate must identify the same `releaseDigest`, status and hash-bound evidence files. WACK needs its original passing verdict; security review needs an independent named reviewer and approving verdict. `accounting` retains the original `29970000` USD-micro new-debit ceiling, `30000` pilot reservation, protected-ledger SHA-256, integer spent/held/remaining amounts, zero unresolved operations and zero outstanding permissions. The three amounts must sum to the original ceiling.

The result always reports `submissionReady: false` and `signingAuthorizationIssued: false`. This command checks evidence completeness and integrity. It cannot authorize funding, retries, replacement, rebroadcast, feature enablement or Store submission. Actual installed-mainnet qualification, independent review, publisher authorization and the submission decision remain separate required work.
