# Windows USB boot and Settings checkpoint — 16 October 2026

This checkpoint adds the interactive one-USB build, startup and storage helpers,
session-only Settings panel, and their focused tests. It is an unsigned test
candidate, not a funded release. The existing transaction/provider restrictions
are not relaxed by this update.

## Behavior

The previous candidate exposed a Settings button whose handler did not open a
panel. The interactive wrapper now installs a panel with Inter/Nunito fonts,
Larger text, Reduced motion and Low effects. Changes apply immediately and last
for the session. Done and Escape close it; focus and desktop scroll are restored.
Preferences are blocked during protected operations. UTC and image identity are
read-only. No preference files, wallet operations or network calls are added.

The startup repair handles unusable stdout/stderr on firmware-framebuffer systems
without a serial port. Boot errors remain visible instead of automatically
rebooting. The one-USB layout protects its boot region and explicitly selects the
separate FAT32 exchange partition, including on larger physical media.

## Exact tested artifact

- Image: `interactive-20261016-r1792156250605-single-usb.img`
- Size: 1,073,741,824 bytes
- SHA256: `d49477fb686f56762bca824f235bb0e04ecb2c0cf23b0cd2c79b061cc904fc72`
- Data volume: `DRIVEKEY`, FAT32, UUID `FFEC-3870`, partition 5, 767 MiB
- The image and prerequisite runtime artifacts are not stored in this source repository.

## Verification recorded for this image

- 7 real Tk Settings tests, 18 startup-runtime tests, 11 generated-initramfs tests
  and 33 storage-policy tests passed.
- BIOS and UEFI runs exercised actual Settings clicks, font/text/motion/effects
  changes, restoration, Escape, keyboard reopening, Done and clean shutdown.
- UEFI used a 31,037,849,600-byte disposable virtual disk. Protected bytes stayed
  unchanged; the exchange filesystem contained only an empty `DriveKey/` directory.
- 26 screenshots were directly reviewed, 13 per normal boot mode.
- A separate firmware-framebuffer/no-serial-port run reached the picker and
  desktop and shut down cleanly. The original image's init-exit panic had been
  reproduced in that configuration.
- All 1,717 inherited protected payload entries remained unchanged.
- On 16 October, after receiving this image and the boot/Settings/shutdown test
  checklist, the owner reported "it works". This is a user-reported successful
  hardware check, not an independently witnessed test or a detailed per-step log.

Local evidence hashes (the generated evidence remains outside Git):

| Evidence | SHA256 |
| --- | --- |
| Normal boot evidence audit | `d5a777070576b1bf2b18af76f1c73d10216082d2feead0c99fbd225c1dd3f6ba` |
| Visual viewport review | `2160936fc0df25cccac627f4970d12141be8107119e0b0cd486ae20aed4ca64e` |
| Framebuffer regression evidence | `9a8e30b03a3ca7ab23a59986a37a37aa3cf5b27f7722a9873bcc3ad686684f3d` |
| Settings test evidence | `f89741f0bbef40863031ebed7417424f8fdc18f6eb9c1041a8cab3ddff3c2284` |

## Build and test prerequisites

These are incremental builders for an existing immutable security candidate;
they do not bootstrap a complete image from a fresh checkout. They require the
original candidate squashfs, manifests and pinned Debian runtime/base described
in the builders. Those local artifacts are deliberately excluded from Git.
Never substitute empty files or bypass identity checks to satisfy prerequisites.

Run the Python scripts in a disposable Debian build/test environment. Each
builder/harness documents its required arguments. The Settings tests use real Tk
and the existing candidate runtime, for example:

```sh
xvfb-run -a python3 -B scripts/test-security-interactive-settings.py \
  --runtime-dir /path/to/candidate/rootfs/opt/drivekey
python3 -B scripts/test-security-interactive-init.py
python3 -B scripts/test-security-interactive-initramfs.py
python3 -B scripts/test-security-interactive-storage.py
```

The Settings runtime must match the tested candidate; an older desktop runtime
from a historical release is not interchangeable. A rebuild produces a new
artifact requiring its own checks. The recorded VM results are not CI results
for every future rebuild.

## Remaining release requirements

Approved provider program identities, the accepted production guard deployment,
successful guarded swap approval/signing on the exact image, full transaction
and recovery acceptance, independent review and authenticated release remain
unfinished. No funded transaction acceptance is claimed. No real wallets,
signatures, broadcasts or physical disk writes were performed by these tests.

To install the tested image, preserve needed USB files and write it with Rufus;
writing replaces the USB layout. On the tested ASolid boot menu, partition 2 is
the UEFI boot entry and partition 5 is the data volume. Do not resize the checked
partitions. Settings preferences reset at the next boot.
