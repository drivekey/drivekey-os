# DriveKey OS

Bootable offline wallet OS. Prepare online, review and sign in a separate offline session, then verify and explicitly submit online.

## Downloads

Open [Releases](https://github.com/drivekey/drivekey-os/releases) for published ISO images, SHA-256 checksums and verification reports. Download the `.iso` attachment, not GitHub’s automatic Source code ZIP. A saved draft is not yet a public download.

## RC20 Warsaw RTC edition

This candidate expects a PC hardware clock set to **Europe/Warsaw local time**. It converts that clock to UTC at startup without writing the hardware RTC. Do not use this edition on a PC whose hardware clock already keeps UTC or another local timezone.

The exact image was tested in disconnected BIOS and UEFI VMs with synthetic, unfunded wallets. It is a prerelease and has not been independently audited.

## Before flashing

Flashing erases the selected USB. Use a spare USB or preserve a separate encrypted vault backup first. Verify the checksum and read the release’s compatibility notes before booting. Never upload private keys, passphrases or vault files to this repository.

- [DriveKey website](https://drivekey.info)
- [Companion app](https://drivekey-app.vercel.app)

This is a release-distribution repository, not a complete OS source checkout. Third-party components retain their respective licenses and bundled notices.
