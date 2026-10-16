# Candidate release review request — 16 October 2026

This continuation prepares public review material for the published wallet acceptance candidate. It does not authenticate the release, authorize installation or enable real-funds operation.

## Exact proposal

The host tool `scripts/prepare-release-review-request.ts` hashes the actual supplied files before producing a manifest proposal, the existing domain-separated signing bytes, and a public byte-identity index. It creates no signing keys or signatures. Existing packets cannot be overwritten. File reads reject links, wrong sizes, mismatched hashes and changed file identities, and are bounded. The config reader opens nonblocking so replacement with a FIFO cannot stall before type validation.

The generated packet is `outputs/funds-release-review-request-20261016`. It binds the published 1 GiB one-USB image SHA256 `48a0e09fc01a59ad9d4d864a90a1e3fc8d6c887a12d36abd32fedec38aab5c5e` and partial source archive SHA256 `2ef4e62a15d919904e8a55ee4531d1370416e0950830f8a731909625b2658748`. The source commit is `ea90891dce2b159c5ec24b2dc0e3a5199ca03707`. The image and partial source archive are the unchanged assets from `v2026.10.16-wallet-acceptance-beta`; the proposal does not imply that source closure has been completed.

Hardware revision `review-only`, sequence `1`, minimum boot version `0`, version `2026.10.16` and the proposed 16 October–15 November 2026 validity window are **discussion values, not accepted device policy**. Custodians must replace them with verified device identity, rollback state, boot floor and validity before any approval. The packet deliberately reports `approvalRequestReady: false`.

The existing `core/release-auth.ts` verifier requires two valid approvals under three distinct pinned public keys. Independent control of those keys must be established outside the developer host. Do not generate all custodian keys here or use a wallet key as a release key. Public roots and their fingerprints must reach the owner over an independently trusted channel. The verifier currently accepts only candidate manifests and never authorizes installation; passing it does not create a protected boot trust root or rollback storage.

The index also inventories the two published evidence archives. Those index entries are **not signed fields** in the existing manifest format; the signature binds the payload and source digests. Evidence must be assessed separately or incorporated into a reviewed source/release package before final authorization. No alternative signature format was introduced.

## Reproduction

With the existing pinned dependencies installed, build the host tools into a new directory:

```text
node scripts/build-release-review-tools.mjs outputs/release-review-tools-new
node outputs/release-review-tools-new/prepare-release-review-request.mjs CONFIG.json outputs/review-request-new
```

The strict config contains `manifest`, `sourceCommit`, `sourceClosure` and 3–32 `assets`; each asset supplies a public basename, local path, exact byte length, lowercase SHA256 and role (`payload`, `source`, `evidence`). Exactly one payload and one source are required. Local paths are omitted from the public index. Commit and closure labels are caller declarations, not independently established by this tool. Use only a deliberately reviewed public asset allowlist: the helper proves byte correspondence, not absence of secrets or source completeness.

The builder records the Node/esbuild versions, source hashes, external imports and package/lock hashes. It is a host tool and is not added to the USB runtime.

## Validation and external actions

Six new proposal checks, six existing release-auth checks and ten read-only verifier CLI checks passed (22 total). They cover altered payload bytes, source substitution, forbidden production proposals, duplicate names, invalid metadata/lifetime, ambiguous roles, exact signing-format correspondence and refusal to overwrite. A separate Linux CLI regression replaces the config with a FIFO immediately before open: the fixed CLI rejects promptly and writes no packet, while a negative control masking nonblocking mode times out. This is internal engineering validation, not an independent security review.

Before release acceptance, an independent reviewer must assess the exact source/build and wallet/transaction boundaries and findings must be resolved. Separately controlled custodians must establish public trust roots, approve real manifest policy and sign the accepted artifact. The owner must complete exact-image physical acceptance and explicitly bounded funded-path acceptance. Until those external actions and the remaining per-flow requirements pass, the image remains an unsigned candidate with real-funds gates disabled.
