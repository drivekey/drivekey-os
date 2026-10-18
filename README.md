# DriveKey OS — Ethereum demo beta

**Encrypted vaults. Offline ETH signing. Uniswap V3 swaps. A completed physical PC demo.**

DriveKey's Ethereum journey now connects browser preparation, offline USB review and signing, and confirmation back in the companion. The recorded VM campaign covers **13 transaction cases**, alongside vault creation, encrypted backup and restoration. The owner also completed the physical PC ETH round trip in the local simulation.

**Prepare → Boot USB → Review and sign → Return to Windows → Confirm.**

## Get the demo

Use the **single-usb.img** for the tested one-USB workflow. The ISO is the boot component; it does not by itself reproduce the tested exchange-partition layout.

| Download | Purpose |
| --- | --- |
| [One-USB image · 1 GiB](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/interactive-20261018-r1792340406957-single-usb.img) | Boot system and exchange partition |
| [ISO component · 197 MiB](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/interactive-20261018-r1792340406957-interactive.iso) | Underlying boot distribution |
| [Windows companion r9](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/drivekey-ethereum-synthetic-companion-r9.zip) | Prepare, resume, submit and reconcile locally |
| [Illustrated walkthrough and pictures](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/DriveKey-X-Article-and-Pictures-20261018.zip) | Full article and 16 original screenshots |
| [SHA256SUMS](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/SHA256SUMS.txt) | Verify downloaded bytes |

This is the **local Ethereum simulation beta**. It uses synthetic balances and receipts; public-chain execution is disabled.

The Windows companion requires the pinned Node **v24.19.0** executable (SHA-256 `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`), PowerShell and a browser supporting Web Locks. Node is not bundled. Follow the package's START-HERE.txt; a generic Node installation will not pass its runtime check.

Preserve a separate vault backup before flashing: writing the image replaces the selected USB layout. Use the exact companion package for its existing sessions. The older hosted app is not this local companion.

## DriveKey in action

We have a completed physical PC demo: prepare an ETH payment in Windows, reboot into DriveKey, review and sign offline, return to Windows, and confirm the exact delivery. Seeing that full loop work is a big milestone for DriveKey.

Here is the journey, step by step—including encrypted backups, wallet restoration and Uniswap V3 swaps. This walkthrough uses our local Ethereum simulation and combines the owner’s physical ETH demo with recorded VM tests. The screenshots are actual application captures from those runs.

The workflow is simple to follow: prepare → boot the USB → review and sign → return to Windows → submit and reconcile. The browser works with the public wallet; the USB performs the signing.

## 1. Create your vault offline

Boot the DriveKey USB, open Wallet and choose Create a new vault. Enter and repeat your passphrase on the offline screen. Once creation finishes, use Verify passphrase to check that you can unlock the vault.

This is the foundation of the workflow: the wallet is created on the USB, and the signing passphrase is entered there.

![Create the encrypted vault inside the offline USB environment. The passphrase fields are empty in this screenshot.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/01-create-vault.png)

## 2. Export your public identity

Open Receive to see your Ethereum address. In Wallet, choose Export public wallet and keep that public JSON file for the companion. Compare the address on both sides when opening the session.

The companion needs the public export only. Your vault, backup and passphrase stay out of the browser. The current export filename is wallet-multi-public.json; this walkthrough uses its Ethereum identity.

![Receive shows the public Ethereum address. Export the public wallet for the Windows companion.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/02-receive-address.png)

## 3. Create and verify an encrypted backup

In Wallet, select Create encrypted backup and complete the offline prompt. Check the saved-and-verified result, then use Verify encrypted backup to test the backup you intend to keep.

After a clean shutdown, keep a separate copy of the encrypted backup away from the original USB. Keep your passphrase securely recorded separately: there is no passphrase reset. A backup sitting only on the original device would be lost with that device.

![Encrypted backup saved and verified. Keep a separate copy so recovery survives loss of the original USB.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/03-encrypted-backup.png)

## 4. Rehearse recovery

Use a separate empty target for the restoration exercise. Place the expected encrypted backup in its exchange folder before booting, then choose Restore to an empty target and enter the backup passphrase offline. Preserve your working vault while doing this.

After restoration, verify the passphrase and compare the Receive address with the original public export. Our recorded restoration recovered the same public wallet identity. Recovery belongs in the demo alongside sending and swapping.

![Restoration completed on an empty target. The recorded test recovered the same public wallet identity.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/04-restore-vault.png)

## 5. Prepare an ETH payment in Windows

On the prepared Windows setup, open Start-DriveKey-Beta.cmd. For the first session, choose C and supply the path to your exported public wallet. The launcher checks the required runtime and package before opening the local companion.

Choose Send, select ETH, enter the amount and a recipient you control for the demo, then select Prepare for offline review. The recorded example uses 0.001 ETH. The addresses shown in these screenshots are test examples; use your own demo recipient.

Download the unsigned request to the USB exchange folder and save the private recovery file too. Before rebooting, press Enter in the launcher and wait for Stopped cleanly. Keep the same companion package and session directory.

![Prepare a payment in the local companion, then download both the unsigned request and its recovery file.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/05-prepare-payment.png)

## 6. Review the payment on the USB

Boot DriveKey, open Send and inspect the prepared request. Read the complete recipient, asset, amount, network and maximum fee. Scroll through the review to check the nonce, request deadline and fingerprint as well.

Compare the recipient with your intended destination before approving. The review puts the actual operation in front of you before the signing step.

![The offline payment review identifies the sender, recipient, network and asset before approval.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/06-review-recipient.png)

![The next part of the review shows 0.001 ETH, the maximum fee, nonce and request deadline.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/07-review-amount.png)

## 7. Sign locally and shut down

Approve the exact reviewed payment, then enter your passphrase in the offline signing form. Wait for the signed-response result. DriveKey saves signed-trade-response.json to the exchange folder.

Use Safe shutdown and return to Windows. Signing and submission are separate actions: the USB produces the signature, and the companion submits it only after your explicit approval.

![The USB saved the signed response. Submission happens later, after shutdown and a return to Windows.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/08-signed-response.png)

## 8. Resume and confirm the exact transaction

Open the same launcher and choose R to resume. If you need to select the original session directory manually, choose O. Keep the same browser profile and local URL. Do not choose C to resume an existing transaction.

Open the saved operation and use Import signed response. If the browser has lost the operation, first load its recovery file under Import recovery file, then open that restored operation. The recovery file and the signed response have different jobs.

Choose Check conditions, review the operation, tick its submission authorization and submit once. Then choose Reconcile exact transaction. In the completed physical demo, the companion reported confirmed, finalized and deliveryVerified: true, with the exact native amount and recipient matched.

If a submission outcome is uncertain, preserve the session and reconcile the existing transaction. A saved “submitted” label is only an intermediate state.

![Owner screenshot from the physical PC demo: confirmed, finalized and deliveryVerified true for the local ETH payment.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/09-physical-demo-confirmed.png)

## 9. Start the swap journey by wrapping ETH

For an ETH-to-USDC journey, prepare a Wrap operation first. Review it under Swap on the USB: the input is ETH, the output is WETH, and the recipient is your own wallet.

Run the same prepare, offline review, sign, submit and reconcile cycle. Confirm the conversion before preparing the next operation. The recorded example wraps 0.001 ETH.

![Wrap review makes the conversion explicit: ETH into WETH, with the same wallet as recipient.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/10-wrap-eth.png)

## 10. Approve a finite token allowance

Prepare a finite WETH approval for the selected Uniswap spender. On the USB, check the spender address, canonical token contract, allowance amount and maximum fee. The recorded example grants a bounded 0.01 WETH allowance.

Sign and confirm this approval separately. A token approval grants spending permission; the swap is the next operation. Choose an allowance suitable for the amount you intend to swap.

![The recorded approval example is capped at 0.01 WETH and names the spender, token contract and maximum fee.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/11-finite-approval.png)

## 11. Review and sign the Uniswap swap

Back in the companion, prepare Swap with WETH as the input, enter the amount, select an approved pool and choose slippage. Download the new request and its recovery file, stop the companion cleanly, then boot the USB.

The offline review displays the input amount, output token, minimum received, pool, router, fees and deadline. In the recorded 3000-tier example, the input is 0.001 WETH, the minimum received is 1.984026 USDC, and slippage is 0.5%. Those numbers belong to the demonstration; review the values in each fresh request.

Approve and sign that exact swap, return to the same companion session, submit once and reconcile the swap evidence. The recorded VM suite completed both WETH-to-USDC and USDC-to-WETH routes through the 500 and 3000 Uniswap V3 fee tiers.

![Swap review identifies the selected pool and the 0.001 WETH input.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/12-swap-input.png)

![The recorded route shows a 1.984026 USDC minimum, 0.5% slippage and the Uniswap V3 3000 fee tier. These are demo values.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/13-swap-output.png)

## 12. Take the reverse route back to ETH

For USDC-to-ETH, first confirm a finite USDC approval, then prepare and sign the USDC-to-WETH swap. Once the received WETH is confirmed, prepare a separate Unwrap operation.

Review WETH as the input, ETH as the output and your own address as the recipient. Sign and confirm the conversion. Every stage has its own request and approval: approve USDC → swap to WETH → unwrap to ETH.

![The reverse route receives WETH. Its minimum output and route are reviewed before signing.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/14-reverse-swap.png)

![Unwrap is its own operation: WETH into ETH, returning to the same wallet.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/15-unwrap-weth.png)

## 13. Close the loop by revoking the allowance

When you finish, prepare an allowance revocation for the relevant token and spender. Review the zero allowance on the USB, sign it, then submit and reconcile it in the companion.

That completes the walkthrough: create, back up, restore, send, wrap, approve, swap, unwrap and revoke. The user reviews each transaction along the way.

![Allowance revocation explicitly sets the selected spender allowance to zero.](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/16-revoke-allowance.png)

## What makes this milestone exciting

The recorded VM campaign completed 13 transaction cases: ETH, WETH and USDC sends; wrap and unwrap; finite WETH and USDC approvals; both allowance revocations; and four swap cases covering both directions across two pools.

Alongside those runs, we now have the owner’s physical PC ETH round trip reaching confirmed delivery. Vault creation, encrypted backup and restoration have their own recorded demonstrations too.

That is tangible progress for DriveKey: the complete wallet journey is taking shape on screen, with offline review at the centre of every transaction. This is the experience we are building toward—clear actions, visible permissions and control in the user’s hands.

## Source and verification

The release includes the frozen [r7 source and notices packet](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/drivekey-r7-source-notices-supplement.zip), [notice-resolution supplement](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/drivekey-r7-notice-resolution-supplement.zip), and [r9 launcher source delta](https://github.com/drivekey/drivekey-os/releases/download/v2026.10.18-ethereum-demo-beta/drivekey-r9-source-change-supplement.zip). Keep all three together. These packets document the distributed binaries and source inputs; they do not constitute a standalone clean-rebuild kit. GitHub's automatic source archives represent the repository snapshot, not the complete OS image source.

The r9 launcher and instructions changed; its transaction engine, client and fixtures remain byte-identical to the r7 campaign. The image itself is unchanged from the tested 18 October artifact. Owner physical ETH success is supported by a screenshot; it is distinct from the 13 VM transaction cases and does not establish full physical acceptance.

Checksums establish byte equality. Independent review and authenticated release remain separate work. The production execution gates are unchanged.

<details>
<summary>Earlier releases and repository documentation</summary>

The following is preserved historical documentation. Use the 18 October downloads and local companion above for this walkthrough.

> **Current wallet acceptance candidate — 16 October 2026:** [Download the tested one-USB image, ISO component and checksums](https://github.com/drivekey/drivekey-os/releases/tag/v2026.10.16-wallet-acceptance-beta). Use the .img for the tested one-USB layout. [Per-flow readiness](docs/funds-readiness-matrix-2026-10-16.md) · [Exact-image boot evidence](docs/funds-boot-acceptance-2026-10-16.md) · [Native wallet acceptance](docs/funds-wallet-acceptance-2026-10-16.md) · [SOL/Ethereum acceptance](docs/funds-multichain-acceptance-2026-10-16.md) · [Provider provenance](docs/funds-provider-provenance-2026-10-16.md) · [Physical rehearsal and controlled-trial instructions](docs/funds-physical-trial-2026-10-16.md). This unsigned, unfunded test candidate is not funds-ready. Full transaction acceptance, independent review, authenticated release and complete build prerequisites remain incomplete. The source handoff is partial. Older download links below remain for historical context.

> **16 October 2026 — USB boot and Settings checkpoint:** [Read the update and verification notes](docs/windows-usb-settings-checkpoint-2026-10-16.md). The owner reports the tested image works on hardware. This is an unsigned test candidate; full transaction acceptance and funds readiness remain incomplete. Existing download links below refer to earlier builds.

# DriveKey OS

### Your keys. Your rules. Your approval.

**An offline wallet operating system built for self-custody and agentic finance.**

## ⬇ Download DriveKey OS

### [Download bootable ISO · RC20 · 546 MiB](https://github.com/drivekey/drivekey-os/releases/download/v21-rc20-warsaw-rtc/drivekey-offline-amd64-v5-desktop-r21-rc20-warsaw-rtc.iso)

**x86-64 · USB boot · Prerelease**

[Compatibility & setup](https://github.com/drivekey/drivekey-os/releases/tag/v21-rc20-warsaw-rtc) · [SHA-256 checksum](https://github.com/drivekey/drivekey-os/releases/download/v21-rc20-warsaw-rtc/drivekey-offline-amd64-v5-desktop-r21-rc20-warsaw-rtc.iso.sha256) · [Verification report](https://github.com/drivekey/drivekey-os/releases/download/v21-rc20-warsaw-rtc/RC20-Warsaw-RTC-VERIFICATION.md)

> Read the build compatibility notes before flashing. The ISO above is the bootable OS download.

---

DriveKey turns a bootable USB into a dedicated workspace for reviewing transactions, signing payments and defining what an agent wallet can spend. Pair it with the online companion to prepare requests and submit signed transactions while keeping your signing workflow offline.

[Open the app](https://drivekey-app.vercel.app) · [Explore DriveKey](https://drivekey.info) · [OS releases](https://github.com/drivekey/drivekey-os/releases)

## Built around your control

- **Offline signing** — review payment details in a separate offline session before authorizing them.
- **Agentic wallet rules** — define allowances, payment caps, approved recipients, schedules and expiry.
- **Simple mode** — move through Spending, Recipients & timing, and Review & sign with a guided interface.
- **Advanced controls** — access detailed limits while working with the same complete policy.
- **Separate wallet roles** — distinguish the agent, offline approver and emergency stop wallet.
- **A connected overview** — check reported spending status, remaining allowance, approval requests and recent activity in the companion.

## From intention to signed action

**Prepare online → Review offline → Sign offline → Submit online**

Use the companion to prepare a request, transfer it to DriveKey OS, inspect the details and sign. Bring the signed result back online for explicit submission. Agent-wallet rule updates follow the same deliberate approval flow.

## Agentic finance, with boundaries you choose

Automation starts with permissions. Set who an agent may pay, how much it may spend and when a separate offline signature is required. Keep the everyday workflow clear while retaining access to the controls behind it.

**Give agents spending rules. Keep authorization in your hands.**

## Get started

1. Open [OS releases](https://github.com/drivekey/drivekey-os/releases) and read the selected build’s compatibility and setup notes.
2. Choose the ISO asset and verify its SHA-256 checksum.
3. Flash a spare USB and boot into DriveKey OS. Flashing erases the selected drive; preserve any existing vault backup separately.
4. Pair your offline workflow with the [DriveKey companion](https://drivekey-app.vercel.app).

Release pages contain build-specific availability, verification reports and screenshots. Current builds are prerelease candidates.

---

This repository contains DriveKey OS source code and release downloads. See [Source and build guide](docs/BUILD.md) for the component map, development commands and image-build prerequisites. The bootable OS is supplied as an ISO release asset. Third-party components retain their respective licenses and bundled notices.

## Built with

**Python · TypeScript · Shell · Solidity · C# · JavaScript**

Explore [desktop source](packaging), [offline signer](offline-signer), [protocols](core), [contracts](contracts), and the [source and build guide](docs/BUILD.md).


</details>
