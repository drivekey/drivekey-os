# Wallet and transfer acceptance, 16 October 2026

This is an internal implementation/evidence inventory. It is not an independent audit, authorization to fund, or a release acceptance certificate. No real funds or external broadcasts were used in the work below.

## Artifact boundary

Published beta `interactive-20261016-r1792156250605-single-usb.img`, SHA256 `d49477fb686f56762bca824f235bb0e04ecb2c0cf23b0cd2c79b061cc904fc72`, has exact-image boot, Settings, shutdown and no-serial evidence. Those checks created no wallet and signed no transaction. Owner-reported physical success establishes only what the owner observed, not a completed transaction campaign.

The new clean candidate `interactive-20261016-r1792160000002-single-usb.img`, SHA256 `48a0e09fc01a59ad9d4d864a90a1e3fc8d6c887a12d36abd32fedec38aab5c5e`, now has the specific two-boot wallet/native-transfer evidence below. It is a virtual, unfunded campaign; the old owner's physical report does not transfer to this image.

Earlier `outputs/security-candidate-images/image-20261012-r1792096400000/guest-boot-bios-tcg-results.json` contains guest lifecycle/signing/publication-crash coverage. Its artifact differs. Inherited source correspondence is useful but does not turn that report into current-image acceptance.

## UI inventory and readiness

The inventory below is from `packaging/drivekey-desktop.py`, wrapped by `scripts/security-candidate-original-gui.py` and the interactive desktop. The online preparation/submission source exists locally but is not fully present in the incremental public source update. Public repo completeness must be reconciled before reviewers can reproduce the system.

| Presented flow | Implemented scope | Fresh evidence | Remaining acceptance |
|---|---|---|---|
| Create native ETH vault | v2 encrypted vault and public identity, Robinhood chain 4663 | Source tests; current clean-image UI create/unlock/public export and host cryptographic verification PASS | Physical recovery and independent review |
| Create multichain vault | v3 EVM + Solana identities; classic supported token requests | Lifecycle key/service source tests | Exact-image UI creation/unlock/public export |
| v2 to v3 upgrade | Preserve old identity and encrypted v2 file; add Solana identity | Lifecycle tests plus historical guest tests | Current image and backup/recovery rehearsal |
| Encrypted backup/restore | Check password, refuse overwrite, restore only empty targets, preserve identity | Source tests; current clean-image v2 backup/check/empty-target restore PASS; restored encrypted/public bytes exactly match | Current-image v3 restore, interrupted physical writes, owner separate backup |
| Public export/receive/QR | Public address files and address-only QR | Current clean-image v2 public export/full address display and cryptographic equality PASS | Current-image v3 and QR flow |
| Native Robinhood ETH transfer | `unsigned-request.json` to signed response, separate online verification/consent | Current clean-image actual review/approval/signing and host exact-byte verification PASS; synthetic online consent/submit/reconcile PASS; real PostgreSQL process race/crash source test | Real validator/chain settlement, physical workflow, authenticated release and independent review |
| Ethereum ETH/WETH/USDC payment | Trade request inspection and isolated key worker | Historical guest coverage; separate source family | Current image exact visible fields vs signed bytes and receipt reconciliation |
| Supported Robinhood ERC-20 | Multichain protocol and guarded offline signer | Fresh multichain protocol/submission tests | Exact-image complete flow and current token/deployment provenance |
| Solana native SOL/classic SPL | Durable nonce, native or TransferChecked token path, optional recipient ATA | Fresh protocol/state/submission tests | Exact-image signing, validator/chain reconciliation, nonce race controls |
| Durable nonce setup/control | Explicit account setup; nonce identity and old-value binding | Fresh nonce setup/offline/control tests | Current image, validator consumption/cancellation races, rent/fee display |
| Ethereum exchange/allowance | ETH/WETH ↔ USDC, LI.FI/Sushi native route and existing WETH route | Historical source/candidate coverage | Current route provenance, exact image, live provider acceptance |
| SOL ↔ USDC exchange | Guarded Jupiter/Raydium | Separate provider investigation | Accepted executable mismatch and guard identity unresolved |
| Savings setup/action/network transaction | UI exposes rehearsals, proofs and exact-action review | Historical specialized suites | Current-image scope and independent chain trust/recovery acceptance |
| Agent rules/payment | UI exposes Robinhood ETH/USDG authority | Historical specialized suites | Current image, deployment/provenance, expiry and recovery acceptance |
| Husher | UI says offline review ready / online execution pending | Historical provider-bound review | Provider execution/settlement incomplete; privacy unverified |
| Hinkal | Proposed meeting/integration only | None | Not implemented or accepted; must not market as working integration |

## Fresh focused source validation

`outputs/funds-wallet-focused-20261016.json`: 185 cases collected, 182 passed and 3 failed. The three failures belong to `multi-offline-files.test.ts`: Linux-only filesystem guards correctly reject Windows. The other 11 suites passed 181 cases; one preliminary rejection case in that four-case suite passed.

The Linux attempt, `outputs/funds-wallet-linux-files-20261016.json`, also did not accept the filesystem suite: the host lacks the fixed packaged `/opt/drivekey/node/bin/node` guarded runtime. Subsequent dependent checks cannot succeed without vault creation. These are retained environment failures, not passed tests and not a reason to weaken the guard. Linux-only optional Rollup 4.63.1 and esbuild 0.28.2 test dependencies were installed in an isolated `/var/tmp/drivekey-wallet-vitest-native-20261016` prefix; repository dependencies were not replaced.

Subsequent packaged-runtime validation resolved that environment gap. All four
storage tests passed in `outputs/funds-multi-files-packaged-runtime-1792163971702`.
The final record `outputs/funds-storage-acceptance-20261016.json` has SHA256
`1b57eccc0434a7cfe0d356549a81b5f5f667f2f409ecc19751effac1f3060ee9` and
binds the runtime to the new image manifest. An overbroad test assertion had
mistaken the public guidance word "passphrase" for a leaked secret; it now
recursively rejects sensitive property names and the actual disposable phrase.
Production sources, sandbox policy and host policy were unchanged. The outer
network namespace contained only loopback, and actual nested production
bubblewrap processes were observed. The short-lived prlimit exec was not
captured, so its invocation is inferred from the unchanged spawning source.
The existing unit test mocks the environment check; this is storage/lifecycle
unit evidence, not guest isolation acceptance. Earlier failures remain recorded.

The passing source tests exercise lifecycle encrypted-format integrity, wrong passwords, changed metadata/ciphertext, KDF limits, source binding, input wiping, transfer fingerprints and exact signed bytes, explicit consent, fee/network restrictions, nonce identity/consumption, durable reservation, expiry after claim, and unknown receipts without automatic resubmission. They use disposable fixtures/mocked RPC, not chain execution or the release GUI.

A separate supported-platform run, `outputs/funds-wallet-focused-supported-20261016.json`, passed all 181 cases in those 11 suites. `outputs/funds-wallet-recovery-20261016.json` passed 54 cases in prepared-intent, trade-recovery, submission-ledger-timeout and savings-enrollment suites. They cover exact form-field binding, bounded transport aborts without retries, uncertain/expired submission reconciliation, changed or noncanonical receipts, retained historical results during RPC outages, exact deployment source/bytecode/constructor binding, and rejection of false trusted-enrollment claims. These do not establish physical enrollment rollback resistance. Current core/offline/test source hashes are recorded separately in `outputs/funds-wallet-source-sha256-20261016.json`.

## Fresh persistence/recovery evidence

- `outputs/wallet-process-acceptance/2026-10-16T14-46-42.518Z-7f43af41/result.json`: PASS. Two separate Node processes race through the actual wallet action/SQL ledger. Exactly one synthetic loopback RPC send loses acknowledgement. A PostgreSQL restart and fresh worker preserve `unknown`, no resubmission. A process crash after committed claim but before send causes no extra send after restart. Owned workers zero; database stopped. Source hashes accompany the report.
- `outputs/wallet-backup-restore/2026-10-16T14-46-56.317Z-79a967e9/result.json`: PASS, `safeToResumeExecution:false`. Fresh PostgreSQL source/restore clusters, authenticated encrypted synthetic dump, tampered/wrong-key rejection, uniqueness/append-only permissions preserved. A post-snapshot claim is intentionally absent after restore: recovery cannot enable execution until independent reconciliation covers the missing interval. This is a journal rehearsal, not production vault backup encryption or a completed physical wallet restore.

## Exact-image QMP campaign

`scripts/run-security-interactive-wallet-acceptance.py` exercises a disposable byte-verified copy using actual USB picker and keyboard/pointer QMP input. It injects no guest code, network, shared folder or synthetic success reply. It records screenshots and inputs, verifies protected image ranges/source unchanged, and exports only explicitly allowlisted public/encrypted wallet files after the guest has stopped. Generated wallets are disposable and must never be funded. A harness run's `success` means controlled boot/exercise/shutdown integrity; `walletAcceptancePassed` remains false until separate output checks and screen review establish particular flow results.

Two completed campaigns bind the clean image above:

- `outputs/funds-wallet-qmp-final-20261016`: actual UI native v2 creation, passphrase check, public export, encrypted backup and separate backup check; clean shutdown, source/protected bytes and host policy unchanged. `wallet-verification.json` independently decrypts the generated output on the host, checks the exported public identity and exact backup equality, and rejects a wrong password. No signed response existed in this first run.
- `outputs/funds-wallet-qmp-restore-sign-20261016`: fresh disposable media populated only with the recorded encrypted backup and a host-prepared synthetic native request. Actual UI restore recovered exactly the first encrypted/public bytes. Three review screenshots show every request field and the application-expiry limitation. Actual approve/sign produced transaction `0xc1d2e37f90f63f95ed6bcabd581849ed10278d5d10ac006ccdd67e7864ddeff1`. Clean shutdown preserved source/protected ranges and host policy. `native-transfer-verification.json` verifies the original injected request/public identity binding, signature and exact transaction bytes; it exercises explicit consent, a disabled send gate, one in-memory synthetic send and synthetic finalized receipt reconciliation without duplicate sends. `actualChainSettlement:false` is deliberate. Three negative binding tests reject changed original request hash, public-wallet hash and source image on copies without changing successful evidence.

The approved fixture was native ETH on chain 4663, amount 0.0001 ETH, gas limit 100000, maximum gas price 2000000 wei, priority fee 0, maximum fee 0.0000002 ETH, maximum debit 0.0001002 ETH and nonce 0. Request/fingerprint, complete sender/recipient, creation/expiry UTC and the warning that local expiry cannot revoke signed bytes were compared visually against prepared metadata by the wallet agent and root agent. This is internal review, not independent security review.

Retained failures are not acceptance: the first fast QMP passphrase attempt (`native-password-verified.png`, despite its intended filename) displayed Operation stopped. A read-only retry after waiting for focus and spacing keys succeeded (`check-slow-result.png`). Input timing is suspected but not conclusively diagnosed. Earlier export captures show disabled/pending UI; only `native-public-export-complete.png` establishes completion. Development boots before the accepted campaign failed shutdown synchronization or hit concurrent-VM memory pressure, and receive no credit. They were stopped; no physical disk or funded wallet was touched.

Native v2 acceptance is narrower than the whole product. v3, Ethereum mainnet, token, nonce and swap paths still need corresponding current-image campaigns. Neither this campaign nor source tests close independent review, release authentication, physical power-loss recovery, enrollment rollback, or complete transaction acceptance. Never fund the disposable wallets used by these tests.

## Reproducing the host acceptance tools

The public repository baseline alone does not reproduce these tests. Use the hash-bound local source archive and match every input in `outputs/funds-wallet-tools/build-manifest.json` first. That manifest records 13 source inputs, the package and lockfile hashes, external imports, Node v24.19.0, esbuild 0.25.12 and generated bundle hashes. `node scripts/build-interactive-wallet-tools.mjs` rebuilds the three host-only tools after the pinned dependencies are available. These test tools and their fixture must not enter the runtime image.

The native verifier's source-only dependency `tests/wallet-submission-fixture.ts` has SHA256 `f6ed1e847924bcb348f4b6ecbdaf35361a26e8d05ff27c677be89f66ae52e388`. It is an in-memory claim-store fixture without credentials, keys or a network transport. It does not establish durable storage; the separate PostgreSQL campaign addresses that boundary. External runtime imports are `@solana/spl-token`, `@solana/web3.js`, `bs58`, `ethers`, `tweetnacl`, `zod`, and Node built-ins; obtain their exact resolved versions from the matching lockfile, rather than resolving fresh floating versions.

The QMP runner needs Linux Python 3, Pillow, QEMU x86_64, mtools (`mdir`, `mcopy`, `mmd`), util-linux (`sfdisk`, `blkid`), the exact image plus its adjacent manifest and ISO, and `run-security-interactive-smoke.py`. It must run with enough memory for its one 3 GiB VM. Run VM campaigns sequentially. It copies the image into a private disposable directory and never writes a physical USB. A fresh run uses `python3 -B scripts/run-security-interactive-wallet-acceptance.py IMAGE OUTPUT_DIRECTORY`. Inputs go through actual QMP keyboard/pointer operations described in the runner; the local `commands.jsonl` contains a disposable test password and must never be published. After clean shutdown, feed that disposable password to `verify-interactive-wallet-output.mjs` on stdin, never as a command-line argument.

For the native rehearsal, `prepare-interactive-wallet-transfer.mjs FIRST_OUTPUT_DIRECTORY` creates a request against strictly synthetic RPC values and the first guest's recorded public identity. `--restore-from FIRST_OUTPUT_DIRECTORY` starts a fresh copy with only recorded encrypted backups and that bound request in the exchange partition. After actual UI restore/review/approval/signing and shutdown, `verify-interactive-native-transfer.mjs SECOND_OUTPUT_DIRECTORY` checks the exact guest-signed bytes and rehearses online verification/explicit submission/reconciliation using in-memory synthetic RPC and claim storage. It does not contact or settle on a chain. `test-interactive-native-transfer-binding.mjs SECOND_OUTPUT_DIRECTORY VERIFIER_BUNDLE` checks rejected original-request/public-wallet/image bindings on copies.

Keep generated wallet files, encrypted backups, unsigned/signed fixture files, raw command traces and disposable media local. Share only allowlisted verification summaries, public hashes, source records and reviewed screenshots with masked secret fields. Do not redistribute whole evidence directories. The first run records smoke helper hash `991b8bfd739895134dc8e440c3769cc0b32aa6ab88ea3071905cc7859252129a`, matching public Git commit `dfea360:scripts/run-security-interactive-smoke.py` as independently checked by the root agent. Its saved `runner-snapshot.py` hash is `91af182e7005cfcc6581a52bcb40c3f038315131745e5efc3918ea2f2729b8df`. Later helper changes are not retroactively attributed to that invocation.
