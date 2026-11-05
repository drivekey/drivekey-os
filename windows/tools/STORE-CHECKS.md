# Local payments-only checks

From the Windows source directory, run `pnpm check:store`.

The command builds, typechecks, verifies generated artifact hashes, and runs every root `tests/*.test.cjs` test plus the compiled signer suite. It does not skip tests. It retains the full historical runner output and exit code in `verification/store-payments/`.

The explicit policy in `tests/store-local-check-policy.json` identifies 25 legacy positive transaction expectations for swaps, bridges and Hinkal that the payments-only Store policy disables. Their test names, source files and denial messages must match. Unexpected failures, missing required payment/boundary tests, skips, or unexpectedly passing deferred transaction expectations fail the payments-only check. Historical recovery and reconciliation tests continue to run.

`STORE-PAYMENTS-CHECKS.json` reports `paymentsOnlyPassed` separately from `fullHistoricalSuitePassed`. The latter remains false while the disclosed legacy expectations fail. A successful scoped check does not make the original full historical suite green. The original `pnpm check` and `pnpm release` behaviour remains unchanged.

This command issues no `ENGINEERING-CHECKS.json`, funded-signing grant or release qualification. It does not modify protected profiles, sign a mainnet transaction, submit anything to Microsoft, qualify installed MSIX, or establish physical isolation. Final package, live-network and publisher gates require their own evidence.

The Store worker fixture covers native and USDC signing on Ethereum, Solana, Sepolia and Devnet. Other unit fixtures remain local test evidence. Review their scope before making public readiness claims.
