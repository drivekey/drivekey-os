# DriveKey Windows payments candidate

Standalone Windows wallet and Offline Companion source. Final installed-package, mainnet and Microsoft Store qualification remain open. No installers are published by this source update.

Direct ETH, SOL and canonical USDC payments are enabled on Ethereum and Solana, with Sepolia and Solana Devnet testing. Swaps, bridges, Hinkal and Savings are deferred for new transactions; historical records remain readable and reconcilable.

## Current local verification

- Full historical suite: 469 passes, 25 deferred-workflow failures, no skipped tests. The standard full release command remains gated by that suite.
- Exact unsigned package workers: 67 direct regressions plus two worker groups covering eight chain/asset pairs.
- Both unsigned packages launched and passed integrity/tamper checks; all 151 original payload files were rehashed.
- Five settlement cases passed on same-host Ganache/LiteSVM, including Solana recipient-account creation, exact fees/rent, invoice claims and recovery.
- Development-native smoke: 24 checks with substituted file dialogs. Additional interactive packaged approval tests timed out before approval and remain unverified.
- Fixed CoinGecko attribution: two boundary tests and one renderer fixture passed. Arbitrary external destinations and offline external opening remain denied.

These are local test results. Historical mainnet transactions identify earlier builds. Finalized SOL/USDC mainnet payments on this package, installed MSIX lifecycle, physical signer separation, independent review, publisher signing and Microsoft certification are not established. See [verification/STATUS.json](verification/STATUS.json).

## Build and checks

Use the pinned dependencies. From this directory:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
node --test tests/payment.test.cjs tests/merchant.test.cjs tests/merchant-solana-verifier.test.cjs tests/market-attribution.test.cjs
node --test tests/store-payment-scope.test.cjs
```

Use the Offline Companion on a separate disconnected computer for the intended separation model. Local software-vault signing is also supported. Preserve unresolved signed transaction records; never automatically replace or rebroadcast them.

## Market-data distribution

The candidate provides a fixed, keyboard-accessible CoinGecko source link beside market data. Attribution alone does not establish commercial rights. A publisher commercial plan or written permission remains unconfirmed; do not infer distribution rights from this source or its local tests. [Attribution guide](https://brand.coingecko.com/resources/attribution-guide) · [Licensing guidance](https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses)

## Source provenance

Reference local source fingerprint: `597d14ef591846138900356277928f04349ebae00ec87b4f6c301c92c16fb396`. Two legacy funding helpers require `DRIVEKEY_LEGACY_FUNDING_DIRECTORY` instead of an embedded developer-machine path. Metadata was removed from two PCB images without changing compressed image data. Export changes are recorded in the status file. Generate fresh qualification and package evidence for builds from this branch.

The source checksum inventory records Git blob bytes. Git may convert text line endings in a Windows working copy; use the repository blob contents when verifying this inventory.

Encrypted vaults, DPAPI credentials, funded-session records, transferable signed responses, generated binaries and local qualification grants are excluded. Dependency notices are in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt); see the repository [LICENSE](../LICENSE).
