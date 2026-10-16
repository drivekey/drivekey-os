# Physical acceptance and funded-trial handoff

Status: preparation only. No funded signing, deployment, authority removal or
submission is authorized by this document. The owner requested operational
workflows; a boot test does not satisfy that request.

## Hardware rehearsal — no funds needed

Use a disposable wallet. Do not import an existing wallet or reuse its passphrase.
Use the exact image and checksum named in the final evidence record; do not infer
that an older image passed checks recorded for a newer one.

Current candidate: `interactive-20261016-r1792160000002-single-usb.img`.
Expected SHA256:
`48a0e09fc01a59ad9d4d864a90a1e3fc8d6c887a12d36abd32fedec38aab5c5e`.
In PowerShell, run `Get-FileHash -Algorithm SHA256 -LiteralPath` followed by
the quoted full path to that downloaded file. Compare all 64 hexadecimal
characters. Do not flash a file whose hash differs. This candidate is still
unsigned; these instructions authorize only the unfunded rehearsal below.

1. Verify the downloaded image SHA256 against the release record before flashing.
   A matching checksum detects different bytes; it does not authenticate the
   publisher unless the release identity/signature is independently trusted.
2. Boot the intended computer with network cables disconnected and wireless
   disabled. Record image ID, firmware boot mode, computer model and USB model.
   Explicitly select the intended exchange volume in the startup picker.
   Expected: desktop opens and identifies that selected volume. Stop on
   a different image, unexpected disk, storage warning or failed isolation check.
3. Create a disposable multichain vault and export its public identity. Check the
   full EVM and Solana addresses against Receive. Never share the passphrase,
   encrypted vault or backup as test evidence.
4. Create and verify the encrypted backup. Shut down completely before copying
   the backup to separate storage. A backup on the same USB is not independent.
5. Restore into an empty disposable target using the accepted recovery procedure.
   Expected: both public addresses match; a wrong passphrase and an attempt to
   overwrite an existing vault are rejected. Do not delete the original to test
   restoration. Stop if recovery asks for an online secret or loses identity.
6. Rehearse one unsigned synthetic payment. Compare full recipient, amount,
   asset/network, maximum fee and applicable expiry/nonce restrictions with the
   prepared request. Cancel once; expected: no new signed response. Reopen,
   approve deliberately, then check that the online verifier accepts only the
   exact matching response. Do not submit it to a public network.
7. Reboot after review but before approval. Expected: previous consent is gone;
   signing requires fresh review and approval. Physical interrupted-write testing
   requires a disposable duplicate USB and a separate backup; it is not permission
   to unplug the owner's only wallet during a write.

Report only step outcomes, image ID and redacted error text. Screenshots must not
include passphrases, recovery material, private vault contents or signed payloads.
These owner observations are physical evidence, not an independent security audit.

## Required funded-trial authorization record

The earlier recorded total ceiling is USD 20. It is a ceiling, not approval to
spend or a verified cost estimate. Do not reset it or assume every route fits it.
Prepare a separate completed record for each transaction before asking approval:

| Field | Required concrete value |
| --- | --- |
| Artifact | Exact image ID, SHA256 and authenticated release identity |
| Route | One specific implemented and accepted operation |
| Network | Chain name and numeric chain ID or genesis identity |
| Public identities | Source, fee payer, full recipient, token mint/contract and any deployed contract/program |
| Purpose | Transfer, allowance, nonce creation, swap, deployment or authority removal |
| Amount | Maximum principal in base units and human units; minimum output for swaps |
| Fees | Maximum network/priority/provider fees, rent/deposits, gas limits and total ceiling |
| Timing | Quote time, enforceable expiry, offline allowance and stop deadline |
| Replay controls | Account nonce or durable nonce identity/value and reservation |
| Recovery | Backup rehearsal evidence and operation-specific cancellation/reconciliation steps |
| Submission | Owner-controlled final signing/submission; no automatic retries/refill |
| Acceptance | Expected receipt, finality, asset/balance delta and independent verification source |

No source/payer/recipient addresses have been supplied for this trial. Current
fees and the all-route total have not been established. This table is deliberately
an incomplete preparation record, not a transaction to approve. Request public
addresses only after release prerequisites and the selected route are accepted.

## Stop and recovery rules

- Stop before signing if any reviewed field differs, a route is unsupported,
  provider code differs from the accepted identity, the image is unauthenticated,
  clock freshness is uncertain, or fees exceed the approved bound.
- After a timeout or lost acknowledgement, preserve the transaction identifier
  and nonce reservation. Reconcile the existing transaction; do not create a new
  payment or rebroadcast merely because the UI did not receive a receipt.
- A failed Solana transaction can consume its durable nonce and charge a fee.
  Re-read finalized nonce and account state before preparing another operation.
  Cancellation and submission can race; cancellation is not assumed successful.
- An Ethereum signature does not expire just because its local review deadline
  passed. Treat already exported signed bytes as potentially executable until
  nonce/state reconciliation establishes otherwise.
- Restoring an encrypted wallet does not restore a trustworthy submission history,
  trusted Savings enrollment, fresh clock state or consent. Keep execution stopped
  until post-backup claims and receipts have been independently reconciled.
- Provider deposit confirmation is not payout confirmation. For Husher, stop
  without documented late-deposit/refund behavior and correlated settlement.
- A suspected compromised boot medium must not be used to unlock recovery material.
  Recovery requires an authenticated replacement and the accepted rollback policy.

## External completion requirements

The owner supplies physical observations and eventually exact public trial
identities and bounded approval. Independent review and independently controlled
release authentication must come from their actual reviewers/custodians. Provider
verification and supported settlement behavior must come from authoritative
provider/deployment evidence. Internal tests or another agent cannot impersonate
those parties or convert missing evidence into approval.
