# DriveKey operational readiness matrix

This is the current acceptance scope, not a release certificate. All funded
paths remain unaccepted. A working desktop and passing local transaction tests
are different claims.

Repository: https://github.com/drivekey/drivekey-os, PR 1. Starting source commit:
`fe25171578c5a22fd686f768fbf24e424e5e71a5`. Starting public beta:
`v2026.10.16-usb-settings-beta`, image `interactive-20261016-r1792156250605`,
SHA256 `d49477fb686f56762bca824f235bb0e04ecb2c0cf23b0cd2c79b061cc904fc72`.

## Current packaging candidate

The published wallet-acceptance image below remains distinct from the fresh
source-built OS candidate r1792170000004. That new candidate uses 216 authenticated
Debian archives and rebuilt application artifacts, without historical runtime
image input. Its boot campaign and assembly-confinement review are in progress;
none of the transaction passes below transfers to it. See
[fresh OS continuation](production-source-os-continuation-2026-10-16.md).

Current source additionally exposes separate EVM gas caps and generic ERC-20
code hashes in offline review. Its 73 protocol and 87 broker tests pass, but it
is not yet included in either image. See
[review field evidence](funds-review-fields-2026-10-16.md).

New image: `interactive-20261016-r1792160000002-single-usb.img`, SHA256
`48a0e09fc01a59ad9d4d864a90a1e3fc8d6c887a12d36abd32fedec38aab5c5e`.
It removes six manifest-bound research entrypoints, preserves all 1,711 retained
inherited entries, and adds runtime package notices. The 74 focused checks pass.
External helper checks add 10 Settings retry/audit tests and five source-handoff
selection tests, plus four multichain observation-semantics tests; these are separate from guest transaction acceptance.

The table below distinguishes the starting public beta from the new candidate.
New exact-image lifecycle and boot evidence is recorded separately in the linked
acceptance documents; an older beta result is not evidence for the new image.
The owner's earlier physical success report applies to the starting beta only.

## Scope inventory

Inventory follows `packaging/drivekey-desktop.py` Wallet, Send, Swap, Receive
and Files, the candidate dispatcher, and the existing online request paths.
“Historical guest” below refers to the automated image
`image-20261012-r1792110088608`, not the public interactive beta. No historical
pass is transferred merely because some source files remain unchanged.

| User flow | Implementation / existing evidence | Artifact-bound evidence | Recovery / external requirement still open |
| --- | --- | --- | --- |
| Boot, exchange selection, Settings, shutdown | One-USB layout, read-only-first identity checks; new candidate has 74 focused checks | New candidate: BIOS and expanded 31 GB UEFI boot, Settings and clean shutdown passed; all 26 normal screenshots reviewed. Separate framebuffer/no-serial selection and shutdown passed. Owner physical report applies only to starting beta | Detailed physical identity/isolation and interrupted-media acceptance; authenticated boot/recovery |
| Native and multichain vault creation | Confined lifecycle workers; historical guest creation | New candidate: native v2 and multichain v3 creation passed through desktop; host vault/public-identity match, both v3 identities and wrong-password refusal passed | Physical backup rehearsal and independent review |
| Public wallet export / Receive QR | Address-only export and display | New candidate: native and multichain public export completed and cryptographically match their vault identities. QR not credited | Cross-check all full addresses after create and restore |
| Encrypted backup, verification, restore, legacy upgrade | Existing lifecycle worker paths and historical guest checks | New candidate: native backup/check and multichain backup passed; both empty-target restores passed. Host verifiers confirm restored encrypted vault/public identities exactly match prior outputs. Legacy upgrade not credited | Physical independent-backup rehearsal, overwrite/tamper refusal on exact image and rollback handling |
| Robinhood native ETH / chain 4663 | Dedicated exact request/review/sign path | New candidate: synthetic preparation/export, actual desktop review/approval/signing, host signature/exact-byte verification and synthetic explicit submission/receipt/no-duplicate rehearsal passed | Actual online browser workflow, persistent-store integration, current network/provider acceptance, physical and controlled public settlement |
| Ethereum native ETH | Trade request and confined signer | New candidate: actual review/approval/signing and exact bindings passed. The same guest bytes executed in local EthereumJS VM with exact value/fee debit, nonce increment and replay rejection. Synthetic online adapter checks remain separate | Actual online browser and durable-store integration, current network acceptance, physical and public settlement |
| Ethereum WETH / USDC transfer | Token action parser and signer; historical guest coverage | Not accepted on new candidate | Allowlisted contract/code identity, fee bounds, recipient/balance receipt verification |
| Solana SOL / classic SPL transfer | Multichain signer and durable-nonce protocol | New candidate: actual native SOL and classic SPL + recipient ATA review/signing passed. Exact guest bytes executed in local LiteSVM with delivered amount, fee/rent debit, nonce consumption and replay checks. Initial account/mint/nonce state is synthetic; no public nonce initialization is claimed | Actual public nonce setup/authority/state, real SPL mint/account identity, online browser/durable-store integration, physical and finalized public settlement |
| Supported Robinhood ERC-20 transfers | Multichain worker | New candidate: chain4663 generic ERC20 review/sign/clean shutdown and exact original signature bindings passed. Exact guest bytes executed against a compiled synthetic token in local EVM: delivery, Transfer event, fee debit, nonce increment and replay rejection passed. This is not mainnet USDC/WETH acceptance | Current deployed contract/network identity, online browser/durable-store integration, physical and public settlement; gas limit, priority fee and token code hash are bound but not separately displayed |
| Solana nonce setup | Separate payer, sole offline authority, durable submission claim; isolated database/browser evidence. Current source setup instructions executed in local SVM; sponsor authority attacks and replay rejected | Source-only disposable-key result; not accepted through current guest UI | Actual physical preparation/sign/submit, current fee/rent budget and receipt |
| Solana nonce cancellation | Separate explicit review; current canonical cancellation and transfer executed in both race orders in local SVM without duplicate debit | Source-only disposable-key result; not accepted through current guest UI | Exact current-image consent, online durable reconciliation and public nonce state |
| Guarded Jupiter SOL to USDC | Local LiteSVM and Agave execution with captured provider code | Successful accepted guarded signing blocked | Accepted executable provenance, reviewed immutable guard identity, exact-image approval and public settlement |
| Guarded Jupiter USDC to SOL | Same local execution scope, reverse route tested | Successful accepted guarded signing blocked | Same provenance/guard gates, token rent and wrapped-SOL closure checks |
| LI.FI / Sushi native ETH to USDC | Approval v9 and local-fork/browser evidence | Not accepted on new candidate | Current supported route/deadline, exact-image approval/signing, independent release and final receipt |
| WETH/USDC Uniswap and allowances | Separate allowance and swap approval; local-fork evidence | Not accepted on new candidate | Both advertised directions, exact allowance limits/revocation, finalized output and fees |
| Husher ETH to USDC deposit | Provider-bound offline review and isolated journal/monitor tests | Not accepted on new candidate | Supported access, enforceable offline window, late deposit/refund correlation and payout settlement |
| Standard Savings setup/action/gas | Rehearsal proofs; local contract deployment and confined signing | Not accepted on new candidate | Trusted enrollment, independent freshness/rollback, deployment identity and physical recovery |
| Strong Savings / signer rotation | Local independent-key simulation and quorum tests | Not accepted on new candidate | Actual independently controlled signers plus Standard gates; same-machine keys do not prove independence |
| Agent rules / pending payment approval | Rule authorization and separate approver workers | Not accepted on new candidate | Independently funded policy identity, exact permissions/expiry, deployed execution and recovery acceptance |
| Hinkal private-balance workflow | Proposed meeting/integration discussion | Not implemented/accepted | Compatibility assessment, explicit architecture, implementation, review and settlement evidence |

## Cross-cutting acceptance

Every transaction route needs evidence for: online preparation; USB export;
offline exact-field review; fresh local approval; signing; online exact-response
verification; separate explicit submission; finalized receipt and asset/fee
reconciliation. Broker tests alone do not prove these user steps. A synthetic
receipt does not establish public-chain settlement.

Adverse-case coverage must bind to the final source/artifact: wrong network,
recipient/amount tampering, fee excess, expiry and uncertain clock, malformed
files, nonce consumption/replay, cancellation races, RPC timeout/unknown receipt,
interrupted writes/restarts, stale backup and enrollment rollback. After restore,
historical submission completeness must be established before execution resumes.

An isolated Chromium check of the current submission component and unchanged
assets route imports/verifies the exact guest SOL signature and exports the
existing request. Missing shared limiter state blocks preflight/status; the
unchanged funded-release gate blocks direct submission. A seeded uncertain
browser record survives reload without allowing resend. This is safe refusal
evidence, not full-app preparation, durable server storage or settlement.

Fresh supported source checks total 239 distinct cases: 181 protocol/lifecycle
cases, 54 recovery/ledger/enrollment cases, and four storage cases subsequently
run with the packaged Linux runtime. The initial platform failures remain in
the evidence. The storage suite retains its existing environment-check mock;
it is not a substitute for actual guest isolation. Separate real PostgreSQL
process-race/crash and backup-restoration rehearsals passed with execution
blocked when restored submission history is incomplete.

## Source and distribution reconciliation

The public branch is an older source baseline plus the incremental interactive
layer. It is not the complete source closure of the tested runtime. Comparison of
261 public Git objects with local files found 189 byte matches and 204 matches
after separately normalizing CRLF. Remaining differences include older signing
and online modules; missing local modules are additional to this comparison.
The builder changed during this increment, so this comparison is a starting
snapshot, not a final-source acceptance record.

Evidence record: `outputs/funds-source-reconciliation-20261016.json`. Git object
bytes were used to avoid mistaking Windows checkout newline conversion for code
changes. No files were copied wholesale over the repository.

The prior interactive payload also inherited research/test entrypoints, and
incremental display/input package license notices needed inclusion. New builder
work addresses these in a new image; old images and their evidence remain intact.
See [release provenance](funds-release-provenance-2026-10-16.md) for actual build
results and remaining build/source prerequisites.

A separate [production application bootstrap](production-payload-bootstrap-2026-10-16.md)
now rebuilds 33 workers and GUI/assets as 112 locked artifacts from the supplied
application source kit. A fresh extracted-kit rebuild matched. Registry checks
matched 61 pinned npm tarballs and 553 consumed dependency files. This closes an
application rebuild layer, not a full Linux OS build, upstream publisher
authentication or correspondence of a newly assembled boot image. The published
image and its previous evidence remain unchanged.

[Debian provenance](production-debian-provenance-2026-10-16.md) additionally
authenticates 103 binary archives and matches 1,630 selected file records through
signed metadata. It recovers 281 corresponding source files for 84 source
versions, including the underlying kernel source. Fourteen historical package
versions and the generated hardware database remain explicit gaps; no silent
upgrades or full OS rebuild are claimed.

## Evidence and decision

- [Wallet acceptance](funds-wallet-acceptance-2026-10-16.md): fresh isolated checks
  and exact-image lifecycle scope, with failures and limits retained.
- [Multichain acceptance](funds-multichain-acceptance-2026-10-16.md): v3 restore and native SOL/Ethereum signed-byte rehearsal, synthetic network scope and retained observer failures.
- [Local execution continuation](funds-local-execution-2026-10-16.md): actual local execution of guest signatures, token acceptance and source-only nonce control, with synthetic starting-state limits.
- [Browser submission boundary](funds-browser-boundary-2026-10-16.md): exact guest import/export and safe refusal with an uncertain local record; not full-app or durable-store acceptance.
- [Provider provenance](funds-provider-provenance-2026-10-16.md): accepted pins,
  captured code, official provenance and unresolved deployment requirements.
- [Physical and funded-trial handoff](funds-physical-trial-2026-10-16.md): owner
  checks, exact authorization fields, spending bounds and recovery stop rules.
- [Release review proposal](funds-release-review-request-2026-10-16.md) and
  [independent review brief](funds-independent-review-brief-2026-10-16.md): concrete
  unsigned handoffs, with no fabricated approval or reviewer identity.

Decision: **not funds-ready; full operational acceptance incomplete**. Internal
agent review is not independent security review. An unsigned checksum file is
not release authentication. Unaccepted or disabled advertised routes stay open
in this matrix until their actual evidence is supplied.
