# Release provenance and reproducibility checkpoint — 16 October 2026

The published beta is a working boot/Settings checkpoint, not a complete
reproducible or authenticated funded release. The new packaging candidate below
removes research entry points and preserves additional runtime notices. It does
not change accepted provider fingerprints, guard deployment identity or funding gates.

## Exact artifacts

| Artifact | SHA256 |
| --- | --- |
| Published `interactive-20261016-r1792156250605-single-usb.img` | `d49477fb686f56762bca824f235bb0e04ecb2c0cf23b0cd2c79b061cc904fc72` |
| Published `interactive-20261016-r1792156250605-interactive.iso` | `6bd1c4c2ac42a331e3245efab020a87ffdfb56acb7fc0eca7def1ac07f3ca0a6` |
| New `interactive-20261016-r1792160000002-single-usb.img` (1,073,741,824 bytes) | `48a0e09fc01a59ad9d4d864a90a1e3fc8d6c887a12d36abd32fedec38aab5c5e` |
| New `interactive-20261016-r1792160000002-interactive.iso` (117,334,016 bytes) | `217e883050798bcbe61fe71f3a39c2a198bbc6c29248591e9e63e1a8c284139c` |
| New immutable payload manifest | `49ea8016106f648d6089e2b0f943c2cf17d7c21654fba5fa3f06a65c9499cb64` |

The original image was preserved. The attempted `...r1792160000001` build failed
before packaging due to a builder variable shadowing the boot label. That bug
was corrected; this failed work directory is not an accepted artifact.

## Implemented packaging changes

The builder validates the original candidate manifest before copying changes.
It then verifies all six research payload identities before deleting any from
the new working root: the original automated image init, two bundled JavaScript
test harnesses and three Python GUI test entry points. Original manifest records
and their hash remain in provenance. No inherited production file is changed.

The new manifest has 1,880 entries: 1,717 original entries minus six research
files plus 169 additions. Internal review independently validated the extracted
root with its existing integrity policy. This is internal agent review, not an
independent security audit. General Python/Tcl standard-library testing modules
remain; removal targets the DriveKey research harnesses and embedded fixtures.

Added runtime notices cover 52 locally inventoried package origins (base and
host are separate origins), including the kernel, Xorg, libinput and initramfs
dependencies. Seventeen common-license texts are installed at their referenced
`/usr/share/common-licenses` location. Each package record includes version,
copyright hash and input hashes. The generated `hwdb.bin` is attributed to the
udev package's generator; its hash is recorded, but its generation is not yet
reproducible from this record alone. Conflicting notice bytes fail the build.

Fresh focused tests passed: Settings 7, packaging 5, startup 18, initramfs 11,
storage 33 (74 total). `focused-release-tests.json` binds test commands, results,
source hashes and the new image-build hash. Boot, lifecycle and recovery results
must be bound separately to this new image; earlier beta results do not transfer.

The external smoke harness now retries its Settings pointer click only on a new
recorded closed/idle state, with a bounded deadline. Its audit verifies each
ordered retry against serial telemetry and preserves the exact keyboard suffix.
Ten helper/audit tests passed, including busy-state and retry-after-open tampering;
five handoff selection tests passed separately. These 15 external tests are not
included in the 74 image-focused count above.

## Required build inputs and gaps

1. Original immutable candidate `image-20261012-r1792110088608`, candidate identity
   `candidate-20261012-r1792078000000`, with `image-build.json` and all four inputs:
   kernel SHA `2b2358b37674d2505350528875bb17afae2a36522a9e8a9417eaca65a7da0e08`,
   initramfs SHA `8fc5dab73dc7bc77c7c68423532460c2d26f52de1f77cccf782d4d2ee76ea199`,
   squashfs SHA `ed2d5e4f91bec7e8f178e4e5544d3f9d45d62541a47ccca4cd4f7116375adbdb`,
   manifest SHA `e23c2c8c8240303e6cc5a38ddfe4d3cc91ff159f09cc2101996d59631d5a7f48`.
2. `/opt/drivekey-candidate-image-base-20261012/rootfs` and sibling `live/`.
   Local extraction record traces these to historical desktop ISO SHA
   `47fea03c1b24e5515ca8552b2a934fd60b4a751985ac363ed05119384503cac6`
   (572,915,712 bytes). Kernel/modules are Debian `6.12.107+deb13-amd64`, package
   version `6.12.107-1`. This is historical local provenance, not authenticated
   Debian download/source correspondence.
3. Host Debian libraries/utilities and tools: Python, squashfs tools, modprobe,
   GRUB BIOS/UEFI modules, xorriso, filesystem utilities and their dependencies.
   Current builders record some consumed hashes but do not pin the complete
   toolchain or deterministic timestamps/identifiers across all output formats.
4. Candidate production sources, package lockfile, transitive npm inputs, native
   tools and corresponding source/license records. The public branch at
   `fe25171578c5a22fd686f768fbf24e424e5e71a5` supplied the incremental interactive
   layer only. Its old signer/core modules must be reconciled before claiming a
   complete public build. A binary prerequisite bundle alone does not solve this.

`verify-security-release-prerequisites.py` pins the original published image,
ISO and immutable manifest before inventorying source correspondence. The local
report found 793 inputs, of which 792 matched; the single difference was the
intentionally updated interactive builder. Of these inputs, 511 are dependency
files under top-level or nested node_modules. This verifies local byte correspondence, not dependency
authenticity or complete upstream source provenance.

## Reviewable artifact channel preparation

`prepare-security-source-handoff.py` creates an explicit allowlisted partial
source/notice archive. Current archive:
`outputs/drivekey-source-review-handoff-20261016-r2.zip`, 352 entries, SHA256
`2ef4e62a15d919904e8a55ee4531d1370416e0950830f8a731909625b2658748`.
It includes manifest-bound production source/assets, package/lock/license files
and packaged notices. `HANDOFF.json` records every member hash and 541 omitted
dependency/test/fixture inputs. It is explicitly `completeBuildKit: false`.
No wallet directories, credentials or generated transaction files are read by
the archive builder. It refuses mismatched source and escaping paths. Five
focused selection tests cover nested node_modules, research harnesses, sensitive
roots and path traversal. The first archive was rejected during internal review
for nested dependencies/research sources; it is retained locally, not accepted
for publication. Only the r2 archive above is the proposed handoff.

The appropriate publication channel is a prerelease asset in
`drivekey/drivekey-os`, with this archive, new image, checksums and evidence.
This document does not claim those new assets have been uploaded. Do not publish
the original candidate squashfs as a fixture-free prerequisite: it contains the
research harnesses removed from the new consumer image. A clean prerequisite
channel requires a dedicated production-only candidate bootstrap and a reviewed
source/dependency closure, plus authenticated package inputs and corresponding
source availability where required. Never silently alter a pinned old squashfs.

## Release authentication and acceptance

Checksums detect changed bytes when the expected checksum is trusted. They do
not establish maintainer identity, Secure Boot authentication or independent
review. Use a maintainer-controlled signing identity for a reviewed release
manifest; publish verification instructions and establish the public key through
an independently trusted channel. Do not generate an agent-owned key and call
it an authenticated maintainer release.

Before writing the image, compute `Get-FileHash -Algorithm SHA256 <downloaded-file>`
in PowerShell (or `sha256sum <downloaded-file>` on Linux) and compare the entire
64-character value and file size to the exact release manifest. For the partial
source ZIP, verify its outer SHA256 above before inspection; `HANDOFF.json`
then supplies the exact uncompressed member byte lengths and SHA256 values.
Check every listed member and reject extra or duplicate member names, absolute
paths, path traversal and mismatches. Matching local hashes proves byte identity
against this checkpoint, not maintainer authentication. A future signed manifest
must bind image identity, image/ISO/source hashes, build commit and evidence
hashes, with signature validation against the independently established key.

Funding readiness remains false. Exact-image transaction/recovery acceptance,
provider and guard provenance, external review and controlled physical/funded
acceptance remain separate gates. No real-funds action was performed here.
