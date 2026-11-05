# DriveKey Windows payments candidate

Standalone Windows wallet and Offline Companion source. This branch is an engineering preview. Solana mainnet preflights passed on two RPCs. Finalized SOL and USDC payments on these Windows binaries remain pending.

The candidate enables direct ETH, SOL and canonical USDC payments on Ethereum and Solana, plus Sepolia and Solana Devnet testing. Swaps, bridges, Hinkal and Savings are deferred for new transactions. Historical records remain readable and reconcilable.

Use the Offline Companion on a separate disconnected signing computer for the intended separation model. Software wallets can also sign locally. Independent security review, physical isolation, publisher signing, installed MSIX lifecycle, WACK and Store certification remain open.

## Build and checks

Run commands from this directory using the pinned pnpm and Node dependencies. The lockfile and vendor notices are included.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
node --test dist/signer.test.cjs tests/payment.test.cjs tests/merchant.test.cjs tests/merchant-solana-verifier.test.cjs tests/profile-evidence-class.test.cjs tests/recovery-storage.test.cjs tests/security-boundaries.test.cjs tests/signature-store.test.cjs tests/solana-adapter-height.test.cjs tests/solana-settlement-cost.test.cjs tests/transaction-store.test.cjs tests/wallet-recovery.test.cjs
node --test tests/store-payment-scope.test.cjs
```

The local direct-payment checks passed 67 tests plus two exact packaged-worker groups. After fixing the extracted-handler policy binding, the broader legacy suite recorded 467 passes and 25 failures from deferred workflows (prior test snapshot `be37a28c5255`). No tests were skipped in that run. The standard full release command remains gated by that suite. See [verification/STATUS.json](verification/STATUS.json).

The local native account-creation test exercised backup verification, offline approval, response import, cancellation, explicit submission, restart recovery and one canonical receipt. Its settlement used LiteSVM on the same host.

The updated development-native smoke suite passed 22 checks, including supported navigation, explicit deferred-route denial, clipboard, independently decoded QR codes, backups and offline API denials. A separate native signing check passed 11 local cryptographic workflow checks; the merchant checkout UI passed six fixture checks. These are development and fixture results, not final installed-package or mainnet qualification. The registry audit reported zero advisories across 399 dependencies.

## Source provenance

The current reference local snapshot fingerprint is `4e0ccfe16d233289d2fd22c49036c948a77f79ddf98e103569c83d36767e55b7`. The changes since the previous snapshot affect only two test harnesses; all 88 generated bundles remain byte-for-byte identical. Two legacy funding helpers in this export now require `DRIVEKEY_LEGACY_FUNDING_DIRECTORY` instead of an embedded developer-machine path. Embedded metadata was also removed from two PCB images while preserving their compressed image data. All export changes are listed in the status file. Generate fresh qualification and package evidence for any build made from this branch.

The source checksum inventory records Git blob bytes. Git may convert text line endings in a Windows working copy; use the repository blob contents when verifying this inventory.

Encrypted vaults, DPAPI credentials, funded-session records, transferable signed responses, generated binaries and local qualification grants are excluded. The repository contains source and assets. Windows installers and Store packages require a separately verified release.

Dependency licenses are recorded in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). The repository license applies as described in [../LICENSE](../LICENSE).
