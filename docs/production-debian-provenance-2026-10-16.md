# Debian runtime and corresponding-source continuation

Two new tools reconstruct authenticated Debian prerequisite archives without
installing host packages, executing downloaded package code, changing the
published image, or enabling funding gates. This closes much of the historical
runtime byte provenance; it is not a complete reproducible OS build.

`prepare-production-debian-prerequisites.py` verifies fresh trixie,
trixie-security and trixie-updates InRelease signatures using `sqv` and the
existing Debian archive keyring. Signed Release SHA256 entries authenticate
compressed and uncompressed Packages indexes, whose SHA256 entries authenticate
each downloaded `.deb`. Actual selected image files are rehashed against the
immutable manifest, then compared with regular archive members. Local symlink
aliases resolve within their recorded provenance root before matching.

Final result: **103 authenticated binary packages, 1,630 matching file records,
zero mismatches, 14 unavailable historical package versions and one generated
hardware-database ownership gap**. File records include selected immutable image
files plus the separately hashed kernel and installed assembler utilities; the
count is not a claim that every file in the image is a Debian package file.

The tool rejects foreign origins/suites, future or expired metadata, redirects,
changed signed-index hashes and changed image bytes. It bounds compressed index,
package, member and total unpacked sizes, streams member hashes, and kills a
package decompressor after 120 seconds. Eight focused tests cover signature
failure propagation, index mismatch, expiry, future date, origin, redirects and
Debian control parsing. Signature tests mock the cryptographic subprocess;
actual signature verification is demonstrated by the separate recorded run.

`prepare-production-debian-sources.py` independently rechecks signed Release
metadata and authenticates Sources indexes. It downloaded **281 files for 84
source package versions**, checking each signed-index SHA256 and size. These
include the signed-kernel wrapper and actual Linux 6.12.107-1 source, following
the wrapper's exact unsigned-kernel Build-Depends through authenticated binary
metadata. No build scripts ran. This is source availability and correspondence,
not proof that these sources reproducibly build the signed binaries; complete
transitive build-dependency and toolchain closure remains open.

## Evidence and reproduction

Public-safe records:

- `outputs/production-debian-prerequisites-20261016.json`, SHA256
  `0fbb67d4dafa25368c7d2737b19a715fe7043472f825bc1e468819cf5aa276bd`.
- `outputs/production-debian-corresponding-sources-20261016.json`, SHA256
  `a358e7f1a245d78724294155c3b8708ccc36c9b09f7c5ba8f513e07aa040552e`.

Each report binds its executed verifier source hashes; the binary report also
records `sqv`, `dpkg-deb`, keyring and immutable-manifest hashes. The existing OS
keyring is the trust anchor, not an agent-generated release identity. This does
not authenticate a DriveKey release or independently establish the build host's
integrity.

On Linux with Python 3.11+, sqv, dpkg-deb and the Debian archive keyring:

```sh
python3 -B scripts/prepare-production-debian-prerequisites.py \
  /path/to/verified-image-root /new/debian-prerequisites
python3 -B scripts/prepare-production-debian-sources.py \
  /new/debian-prerequisites/debian-prerequisites.json \
  /new/corresponding-sources --download-sources
python3 -B scripts/test-production-debian-prerequisites.py
```

This currently inventories package ownership from the existing host dpkg database
and historical base at `/opt/drivekey-candidate-image-base-20261012/rootfs`.
It is a prerequisite recovery tool, not a standalone replacement for those bases.
The immutable manifest and actual file hashes prevent silent source substitution;
authenticated Debian metadata and archives provide the upstream correspondence.

The `--verified-cache` option reuses only archives whose bytes match the newly
verified signed metadata. Output directories must be new. Final local caches are
`/opt/drivekey-production-debian-prerequisites-20261016-r7` and
`/opt/drivekey-production-debian-sources-20261016-r9`. Earlier incomplete runs
remain separate. Cached expired metadata was rejected; no freshness override was
introduced. Future Debian metadata changes may require the retained signed
metadata and archive cache for archival reproduction.

## Remaining exact-input gaps

The following historical versions were not present in the three fresh signed
indexes. The binary report includes exact signed current alternatives but applies
none of them:

| Package | Historical version | Current signed alternatives (not applied) |
| --- | --- | --- |
| base-files | 13.8+deb13u6 | 13.8+deb13u7 |
| busybox | 1:1.37.0-6+b8 | 1:1.37.0-6+b9 |
| fdisk, libblkid1, libmount1, libsmartcols1, libuuid1, mount, util-linux | 2.41-5 | 2.41.5-0+deb13u1 |
| libaudit1 | 1:4.0.2-2+b2 | 1:4.0.2-2+deb13u1 |
| libcap2 | 1:2.75-10+deb13u1+b1 | 1:2.75-10+deb13u1+b3 |
| libexpat1 | 2.7.1-2 | 2.8.3-1~deb13u1; 2.9.0-1~deb13u1 |
| libpcre2-8-0 | 10.46-1~deb13u1 | 10.46-1~deb13u2; 10.46-1~deb13u3 |
| libsqlite3-0 | 3.46.1-7+deb13u1 | 3.46.1-7+deb13u2 |

`usr/lib/udev/hwdb.bin` is generated; it needs a pinned deterministic generation
recipe and source-input binding rather than a fabricated package-owner match.
Recovering authentic historical packages or producing a new candidate with
explicitly reviewed current versions remains necessary. Full dependency solving,
production-only rootfs assembly, Linux Node/toolchain authentication,
deterministic boot-media construction and new-image acceptance are not closed by
this evidence. Complete source closure for the 14 unavailable binary versions is
also not claimed.

Maintainer release authentication, external review, provider/guard approval,
physical acceptance and real-funds trials remain separate gates.
