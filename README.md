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

