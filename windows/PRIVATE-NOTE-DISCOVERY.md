# Public history and offline note inspection

This is incomplete engineering behind the closed `privateBalanceDiscovery` capability. It does not qualify a private payment, available balance, native file handoff, separate-device signature or mainnet settlement.

The online worker accepts only a chain. It downloads the SDK's global encrypted commitment snapshot from the pinned Hinkal origin and exact chain-specific path, with redirect refusal, bounded strict UTF-8/JSON parsing and no wallet or viewing-key input. It rebuilds the contiguous commitment tree, verifies every public page hash and checks the indexed root and deployment through two independent HTTPS RPC origins. Reader URL credentials are excluded from returned observations. A newer pool cursor leaves current commitment coverage incomplete. A root/cursor reorganization invalidates the observation.

Snapshot ciphertexts are candidate data. Root membership alone does not authenticate the association of an encrypted output to a canonical transaction or demonstrate that all output ciphertexts were supplied. Cached provider nullifier lists are not used as spendability evidence. `ciphertextHistoryVerified`, `spendabilityVerified` and `eligibleForSigning` remain false.

The Companion imports the complete public file after separate backup verification and native privacy review. A network-denied child verifies public membership before unlocking the exact encrypted wallet. It derives the existing Hinkal identity internally, recognizes canonical ETH/USDC or SOL/USDC notes, and recomputes each owned commitment, amount and nullifier. No viewing key, login signature or private note identifier is returned to the renderer. The renderer receives pending aggregate amounts and completion metadata only; shared balance hiding masks those amounts.

Three DPAPI-protected journals bind the original job, per-page private result and completion summary to the full wallet stamp and snapshot. Interrupted work exposes progress and resumes only with the matching original public history file. Cached inspection still verifies the passphrase. Missing original jobs, missing/mismatched journal keys, corrupted private records and conflicting owned-note identities fail closed and preserve existing bytes. Duplicate global leaves never count twice toward a pending amount. Public witnesses use a separate immutable cache without a journal key. Explicit reimport can add a valid witness beside damaged public copies; it never overwrites the damaged copy or repairs private authority.

Production denies both inspection and public-history worker entry. Test-only entry sentinels, synthetic preload/dialog fixtures and crypto fixtures are excluded from packaged artifacts. Tests exercising such fixtures establish the stated boundary only.

## Deployment identity

The Ethereum preparation guard additionally pins the SDK-deployed helper address and runtime hash, rejects proxies, checks the pool's helper registration and the helper's pool counterpart at the same block, and repeats the registration. Public code bytes matched two independent RPC readers. This is an identity observation, not independent verification of compiled deployed source. The official [HinkalBase](https://github.com/Hinkal-Protocol/Hinkal-Contracts-Circuits/blob/main/contracts/HinkalBase.sol) and [HinkalHelper](https://github.com/Hinkal-Protocol/Hinkal-Contracts-Circuits/blob/main/contracts/HinkalHelper.sol) sources expose mutable registrations; changes must fail closed pending review.

## Remaining acceptance

Independently authenticate encrypted-output history and any snapshot tail against canonical chain data. Determine current owned unspent state through independent readers and resolve reservations using settlement evidence. Bind recipient/change notes, proofs and transactions to actual settlement. Finish portable complete checkpoint recovery and address profile rollback and duplicate-key devices. Qualify the original full feature matrix through the installed mainnet app only after the required local, native, physical-device, publisher and independent final-hash security gates pass.
