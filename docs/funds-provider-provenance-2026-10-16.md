# Guarded SOL/USDC provider and guard readiness — 16 October 2026

**Guarded production swaps remain blocked.** Fresh public-chain reads confirm that both provider executables differ from the accepted pins. Local compatibility evidence exists for both directions, but neither provider has source-to-binary acceptance for these bytes, and the DriveKey deadline guard has no accepted public deployment. No pins, release gates, wallet keys or deployed programs were changed by this investigation.

## Fresh observations

`node scripts/check-jupiter-current-artifacts.mjs` captured finalized public Solana state at slot **457675837**, after checking the mainnet genesis hash. The raw snapshot is `outputs/jupiter-current-readiness/2026-10-16T14-46-18.482Z-01b15e62/public-program-snapshot.json`, SHA256 `aa674f0aac472f4bba1ad8dfd841d5752baa8395c917058ad000c8a1ae28b7d2`.

The subsequent provenance record is `outputs/jupiter-upgrade-provenance/2026-10-16T14-46-25.813Z-f364586c/manifest.json`. Paths in this document are relative to the local implementation root. This output directory also retains provider verification responses, official authority documentation, public upgrade receipts and governance account bytes. These are RPC/source observations, not independently authenticated consensus proofs.

| Property | Jupiter | Raydium CLMM |
|---|---|---|
| Program | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` |
| ProgramData | `4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT` | `HzD2cCXXT3UQNjMMY6kDv9w6gZ9qquSdfoGXrLL3LXx` |
| Last deployment slot | 454465850 | 451479902 |
| Current authority | `CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ` | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` |
| Full executable allocation bytes | 2892224 | 1700160 |
| Observed full allocation SHA256 | `099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f` | `b1e8b3eb1c0027b3c05b059dec773661cbe93e2b304c1166e575b502ee2ca6d2` |
| Accepted SHA256, unchanged | `7bfe71031cc06010971fbf7bc3bc5c6499212d26170f110f32d4ee1c79909859` | `c8fa1d9f02c63123c118b27a96a4e73ec4c015f16b093872afceb7657bfac4b0` |

These observed hashes match the retained October 12/15 candidates. Repeated observations establish byte identity across those observations, not approval. DriveKey hashes all executable allocation bytes after the 45-byte ProgramData header. The verifier's trailing-zero-trimmed hashes are a different digest convention; changing that convention would not resolve source correspondence.

Both [Jupiter verification status](https://verify.osec.io/status/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4) and [Raydium verification status](https://verify.osec.io/status/CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK) returned HTTP 200 with `is_verified:false` during this run. Jupiter supplies no source commit. Raydium references `119ed36bf9f33335ed8d671780502bc37d9f1605`, but supplies no successful executable build hash or verification time. Its reported on-chain hash matches the locally trimmed captured bytes. That is useful identification, not a verified build.

[Jupiter's CPI repository](https://github.com/jup-ag/jupiter-cpi) contains client/IDL helpers and is archived. It does not establish correspondence with the deployed aggregator implementation. [Raydium CLMM source](https://github.com/raydium-io/raydium-clmm) is public, but a current branch or old verifier reference must not be assumed to build the captured binary. No deterministic provider rebuild was established here. [Solana's verified-build documentation](https://solana.com/docs/programs/verified-builds) describes source correspondence separately from security assurance.

## Deployment provenance recovered

- Jupiter's finalized RPC receipt at slot 454465850 has signature `49y7tQt1wV18UfBZ7KDMRj23Ss6ZWx9Z2Fns8wiKDGMdM9GmEGuVK4b2BoptP55VjUKZgUiyghWBq2WTDLg9LdsE`. The saved transaction reports successful loader execution and an inner upgrade targeting the expected Jupiter Program/ProgramData, with the captured authority. Receipt: `jupiter-upgrade-transaction.json`. This improves the previous report, which had no upgrade receipt. The outer executor is `SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu`; its control policy has not been independently verified.
- Raydium's finalized block 451479902 contains a successful upgrade log for the expected CLMM program. Its first signature is `3XaEkvxifbUJGAEP4xeTBta4B7btXq9VHDfaHE2f1h1G9vPL2e78c34h2Wra65ZdnQa7wzo52psTga32vr4yrKSJ`. Raw block: `raydium-upgrade-block-v1.json`; selected receipt: `raydium-upgrade-block-v1-matches.json`. The first request with maximum transaction version 0 returned an unsupported-version error because another block transaction requires version 1. The retained second read allowed version 1; this is only evidence retrieval and does not broaden DriveKey's supported signing formats.

These receipts were retrieved read-only from the public RPC. A subsequent offline check reconstructs the canonical outer messages with installed Solana web3.js and verifies every required Ed25519 signature: Jupiter is legacy with one signer; the selected Raydium upgrade is version 0 with two signers and no address-table lookups. The Raydium selection exactly matches the retained block transaction and recorded block-file hash. Version 1 retrieval was needed for another transaction in that block; it is not the selected upgrade's format. The verifier refuses version 1, unknown versions and lookup-bearing messages rather than silently extending support.

Result: `outputs/funds-retained-upgrade-signatures-20261016.json`. Host-only verifier: `scripts/verify-retained-upgrade-signatures.mjs`; focused tests: `scripts/test-retained-upgrade-signatures.mjs`. All 22 tests pass, including changed message/instruction bytes, signature, signer, signature count and version/domain negatives. Run `node scripts/verify-retained-upgrade-signatures.mjs outputs/jupiter-upgrade-provenance/2026-10-16T14-46-25.813Z-f364586c NEW_REPORT.json` with the existing frozen project dependencies; no network or signing is performed. Captures remain required local inputs. The report binds input, helper, dependency-entry and lock hashes.

This establishes authorization by the required outer transaction signer keys for the reconstructed message bytes. It does not authenticate RPC receipt metadata, CPI/inner execution, block inclusion or finality, governance policy, the uploaded executable buffer, or audited source correspondence. A multisig executor's outer signature is not proof that the full governance policy was satisfied. Logs alone remain insufficient for those claims.

## Raydium governance discrepancy requiring resolution

Raydium's [official address source](https://github.com/raydium-io/raydium-docs-v1/blob/main/reference/program-addresses.mdx) identifies the same captured upgrade authority and config account `tr8rgazUrZzgdkfc6Q622nVJHMMzh29trdBE2uBHb4u`. Its [security documentation](https://docs.raydium.io/security/admin-and-multisig) describes a 3-of-4 Squads upgrade multisig with a 24-hour timelock. Saved source files `authority-source-0.txt` and `authority-source-1.txt`, and their hashes in `authority-sources.json`, preserve that claim.

At finalized slot **457676021**, the documented config account is owned by Squads v4 program `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`. Applying the [official Squads Multisig layout](https://github.com/Squads-Protocol/v4/blob/main/programs/squads_multisig_program/src/state/multisig.rs) to its bytes gives:

- Matching Anchor `account:Multisig` discriminator: `e07479ba44a14fec`.
- Default/zero config authority; threshold **3**; **4** members, each permissions mask **7**.
- `time_lock` at bytes 74–77 is **0 seconds**, not 86400.
- Transaction index 54; stale transaction index 7.
- The [official vault PDA derivation](https://github.com/Squads-Protocol/v4/blob/main/sdk/multisig/src/pda.ts), with this config and vault index 0, yields exactly `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` (bump 254).

Raw evidence: `raydium-governance-accounts.json`; decoded fields: `raydium-governance-decoded.json`; saved layout: `squads-multisig-layout.rs`; PDA source: `squads-pda-source.txt`. This supports attribution of the captured authority to the documented config but **does not support relying on the documentation's 24-hour on-chain timelock**. Reconfirm independently and obtain an authoritative explanation of whether an additional policy exists outside this config. This discrepancy is not evidence of a compromise, nor is it permission to weaken pins.

## Existing isolated execution evidence

The October 12 document's missing-runtime and missing-route-snapshot blockers are superseded for isolated compatibility work:

- `outputs/jupiter-route-state/2026-10-15T18-41-45.624Z-625308ef` preserves raw accounts and builds. Manifest SHA256 `79588779696d8ec24a6ea45129aa2913f447228db2289c071b6ecc4c8b051621`.
- `outputs/jupiter-guarded-compatibility-1792145726817/results.json` records passing guarded SOL→USDC and USDC→SOL compatibility in network-isolated LiteSVM, including controlled-clock boundary cases. It explicitly rejects provider production acceptance.
- `outputs/jupiter-guarded-validator-1792146089848/results.json`, SHA256 `ac64f064ee005df7bfd0da3eb6cd34415a303e6eecf1f7b3b10b42c565d39c9a`, records loopback-only Agave 3.1.8 cases with captured provider bytes, actual SBF guard, synthetic assets, nonce/replay/cancellation behavior and no public network submission. Its terminal audit binds source hashes. Exactly-at-expiry behavior belongs to the controlled-clock campaign; the validator uses observed before/after times.

These records are retained evidence, not newly repeated executions in this investigation. They use a synthetic guard identity and deliberately separate unaccepted provider bytecode from production policy. They do not establish successful signing in the production offline worker, acceptance on the released USB image, current pool freshness or mainnet settlement.

## Guard source, binary and release requirements

`contracts/solana-deadline-guard/src/lib.rs` and `src/policy.rs` implement the `DKEXPR01` instruction with an exact 16-byte payload and no accounts. It reads the runtime Clock, accepts only strictly before expiry, and has no CPI, custody or administrative instruction. Expired execution can still charge a fee and consume a durable nonce; expiry is not cancellation or reconciliation.

The retained 23936-byte SBF binary SHA256 is `20486be96c7ecf1d0c5369c228b854435b99769d8a2f5dd15862b0ff4902f9b2`. Tooling is documented as Agave 3.1.8/platform-tools 1.52, with Rust/SDK/Cargo locks. Two local builds on one WSL host matched; this is not independent build review. `DEADLINE_GUARD_RELEASE` remains `null`.

The offline release-evidence verifier was exercised again: **29/29 tests passed** with `node node_modules/vitest/vitest.mjs run tests/deadline-guard-release-evidence.test.ts`. It checks exact artifact identity, canonical ProgramData, signed loader deployment/authority-removal binding and consistency of supplied finalized RPC claims. It correctly leaves chain authentication, independent review, release acceptance and funding readiness false. `node scripts/verify-deadline-guard-release.mjs --requirements` emits the concrete required schema; no deployment or spending occurred.

Before a deployment can be proposed concretely, finish independent source/binary review and select the approved exact binary. Then prepare a bounded network/deployment budget with the owner's public fee payer, fresh Program address, canonical ProgramData, maximum rent and fees, authority-removal procedure and stop conditions. The owner must explicitly authorize the actual deployment and permanent authority removal. Capture finalized receipts and immutable account bytes, rerun the verifier, and propose any accepted identity as a separately reviewed source change. No environment override or invented address substitutes for this process.

## Focused correction and remaining acceptance sequence

`scripts/check-jupiter-current-artifacts.mjs` previously always claimed that no raw route-account snapshot existed, and treated lack of a checkout-level `litesvm` module as a general runtime blocker. Both statements overstated what the tool inspected. It now accurately reports its program-identity-only scope and checkout-local module resolution. A fresh run still rejects both actual mismatched provider hashes; production policy is unchanged. This reporting-only correction was verified by that live read-only run, not by altering validation.

1. Obtain deterministic source/build correspondence for the captured provider versions, or explicitly document any unavailable source and an independent reviewed trust decision. The owner is not being asked to find unknown binaries; program identities, observed hashes, source candidates and deployment receipts are now concrete.
2. Resolve the Raydium timelock discrepancy and independently verify Jupiter authority governance plus both upgrade transactions' inclusion, execution and finality. Outer message signatures now verify offline, but do not close these remaining checks. Mutable provider upgrades remain a material trust dependency between preparation and execution; a client-side hash read does not lock future executable bytes.
3. Complete independent review of provider account invariants and the guard, then separately approve any pin-only change and public immutable guard deployment. Compatibility success alone cannot authorize those changes.
4. Rebuild the intended release with accepted identities and repeat complete offline review/signing, submission and reconciliation in both directions, including recovery and uncertain receipts, on that exact image. An unaccepted candidate must remain blocked in production.
5. Only then prepare and seek explicit approval for a small funded hardware trial with exact addresses, amounts, fees, recovery and stop conditions. No funded trial is justified by this report alone.

The external dependencies are specific: provider source/build disclosure or an explicit independently reviewed trust exception, independent security/build review, resolution of governance evidence, and an owner-approved immutable guard deployment. Internal agent work cannot truthfully replace independent review. Hinkal remains a proposed separate integration and is not evidence for guarded Solana swaps.
