# Fresh OS assembly continuation

This is a separate engineering candidate. It does not replace the published wallet-acceptance image, enable funding gates, authenticate a release, or transfer transaction acceptance to changed OS bytes.

## Implemented

`bootstrap-production-debian-base.py` builds a new extracted runtime in a new `/opt/drivekey-production-base-*` directory. It rechecks Debian signatures and signed index hashes, resolves dependencies with private APT state, verifies every selected archive against signed SHA256 metadata, and extracts in a networkless namespace with the host read-only. It does not install packages on the host or run package maintainer scripts. Its base is deliberately not described as a configured Debian installation.

Successful base `20261016-r7` contains 216 authenticated binary archives. It records 22 explicit version changes from the historical selection: the 14 previously unavailable versions and eight additional current selections needed for a consistent dependency graph. Generated hardware database and kernel module metadata come from tools in the new extracted base. Host package status stayed unchanged. The complete inventory includes 14,573 entries. Four tests exercise actual namespace write confinement, symlink escape rejection, separate networking, and Debian version ordering.

`assemble-production-source-image.py` composes that base with the 112 exact artifacts from the independently reconstructed application source kit. It downloads Node 22.23.3 and its official HTTPS checksum list afresh, verifies archive and selected member hashes, and records that PGP verification has **not** been performed. It copies the existing interactive init/storage/desktop/settings and candidate GUI wrapper from source. It does not read the historical squashfs, ISO, runtime directory, fixture generator, or wallet.

The full installed kernel module tree is omitted from the new root so udev cannot discover unapproved drivers. Only the existing explicit boot module allowlist enters initramfs. Absolute guest symlinks become equivalent relative links. Missing postinst/alternatives links are explicitly recorded and omitted, with the required BusyBox shell link installed. The existing candidate integrity policy validates the complete resulting root; every readiness/authentication gate remains false. Four tests reject altered files, extra files, symlink-parent traversal, and path traversal.

`distribute-production-source-image.py` and `build-production-source-usb.py` are separate adaptations of the reviewed ISO/GPT builders. They retain the fixed 256 MiB immutable prefix and empty exchange partition geometry, verify the new exact source set, and write regular files only. The original builders remain unchanged.

## Diagnostic candidate

Workspace: `/opt/drivekey-production-images/interactive-20261016-r1792170000004`.

| Artifact | Bytes | SHA256 |
|---|---:|---|
| Single USB image | 1073741824 | `6511b72d5bd17edae711fcc604830b2890769c396c70d08d00a606e0f1322db1` |
| ISO component | 245725184 | `873a00b666d2c7c31d54c0ab9486ab76b3cf0e351a732b463da6b4adecd34702` |
| Root squashfs | 204812288 | `40a7f5ed881466ca303f67a28cc52c37b72d321b43877e8e75fc65f959a477c1` |
| Immutable manifest | 2027958 | `f53e38c1c8f19b263a53208283b17d5dcad9a415034c1ab0b1615e41c82866be` |

Earlier diagnostic directories remain: r1 caught an initramfs path-normalization bug; r2 successfully composed the full package tree but exceeded the fixed ISO extent and retained unneeded kernel modules. r3 boot reached PID1 but correctly failed closed because the new manifest enumerated volatile roots, including `/proc`; this was reproduced in a read-only namespace. Evidence remains in `outputs/interactive-boot-single-usb-bios-1792169085750`. QEMU stopped; source image and host policy remained unchanged.

r4 excludes volatile mounts from immutable inventory traversal and restores the original seven input/DRM udev rules. Its unchanged candidate policy successfully validates all 8,340 manifest entries inside a read-only, networkless namespace with actual `/proc` and `/dev` mounted. Packaging and GPT/FAT validation pass. At this checkpoint no VM, hardware, wallet, signing, or transaction acceptance has been established for r4. No VM remains running.

## Remaining work and limits

The new base no longer requires the historical immutable runtime artifacts, but signed package archives are not reproducible builds from corresponding source. The previous source provenance packet covers its explicit historical/current matches, not automatically every one of the 216 newly resolved packages or all transitive compiler inputs. The bootstrap records host tool hashes; this does not authenticate or independently reproduce the build host. GRUB/ISO tooling similarly needs a closed, authenticated toolchain recipe. Node has HTTPS checksum correspondence, not independently verified publisher signing keys.

The extracted Debian base is broader than a curated runtime and has not received security acceptance. Do not distribute any diagnostic image as accepted. New OS versions and package configuration require new boot, isolation, GUI, storage, recovery, and transaction regression evidence. No previous physical test or wallet acceptance is claimed for these changed bytes. Independent security review, owner-controlled authenticated release, provider readiness, and real-funds authorization remain separate gates.
