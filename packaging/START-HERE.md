# DriveKey graphical release v3 — portable source package

Current instructions are in WINDOWS-WALKTHROUGH-V3.md. The graphical image is `drivekey-offline-amd64-v3.iso`. It opens a local Vault / Review & sign / Backup & recovery interface automatically. Use Safe shutdown before removing USB. The text below documents the retained v2 CLI fallback. This ZIP is source/runtime packaging, not a bootable image.

## Retained terminal workflow

Read the included **WINDOWS-WALKTHROUGH.md** from beginning to end before preparing a physical USB.

- The actual boot image is `drivekey-offline-amd64-v2.iso`, available from Setup on the local build PC and project `outputs/images`.
- This ZIP is not the boot image. The Windows ZIP contains the companion and runtime; the offline ZIP contains bundled signer/runtime sources and the build recipe.
- Start with an unfunded test vault. A clean Windows x64 PC and a compatible removable USB are required. No Linux installation on your internal disk is required.
- The image includes a 64 MiB FAT32 exchange partition labelled `DRIVEKEY`. Preserve the whole image with a raw/DD write only after you approve erasing the exact USB yourself.
- Do not alter Secure Boot, firmware or BitLocker just to make this prototype boot. Stop if it is rejected.
- Boot offline: `sudo drivekey-offline create`. Verify an existing or restored vault with `sudo drivekey-offline check-vault`, which needs no funds or request. Recover public metadata with `sudo drivekey-offline export-public`. Sign only after full review with `sudo drivekey-offline sign`. Always finish with `sudo poweroff`.
- No passphrase belongs in the website. USB gestures are workflow events, not uncopyable hardware authentication. A lost password/file cannot be recovered by reconnecting.
- Keep mainnet submission disabled until physical tests and one exact tiny transfer are explicitly approved.

## Rebuilding (developers only)

Use Debian 13 amd64 and work on its Linux filesystem, not /mnt/c. Install live-build, debootstrap, xorriso, squashfs-tools, isolinux, syslinux-common, grub-efi-amd64-bin, mtools, dosfstools, xz-utils, file and certificates. Extract the full offline source ZIP and run `sudo bash build-live-image.sh`.

The builder downloads OS packages during construction. The resulting live environment includes Linux, Node 22.23.2, and all signer dependencies before boot; no first-boot downloads. The finalizer injects the launcher and locked autologin live account, BIOS/UEFI boot configuration, dependency licenses, and the empty exchange partition. Its targets are regular files, never block devices. A new build has a new hash and needs its own boot tests.

Unsigned, unaudited trusted-clean-PC prototype. An ordinary USB remains copyable; Secure Boot support, physical Windows mounting and native reconnect gestures need user testing. Emulator success is not hardware verification.
