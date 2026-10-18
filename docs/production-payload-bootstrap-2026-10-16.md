# Production application bootstrap continuation

The new `scripts/bootstrap-production-payload.mjs` builds all 33 confined worker
programs and GUI/assets into a fresh application directory without executing a
fixture generator, signing a transaction, copying an old candidate, or enabling
release gates. It does not yet assemble a bootable Linux OS. Existing published
images, frozen builders and core wallet source remain unchanged.

The recorded Windows x64 build consumes 788 explicit input files and creates
112 artifacts. Two separate new-directory builds matched every locked artifact
hash. Four bootstrap negative tests cover unsafe paths, synthetic inputs, changed
source/toolchain and extra/missing artifacts. Seven registry verifier tests cover
tampered integrity/content, duplicate/traversal tar members, links and lock scope.

## Isolated proof-library dependency

Three existing core modules import `scripts/savings-inclusion-research/library`.
The bootstrap redirects only this module to
`packaging/production-proof-dependencies/library.ts`; the production files do
not import the research directory. The copied adapter is byte-identical to the
original (`af348949bb2333f668ea548e0925a3ae8018456f39db6b56e0a1a7fcd8940024`).
Its original comment describes its old location; the adapter itself only exports
MPT and RLP library functions. The isolated package pins `@ethereumjs/mpt` and
`@ethereumjs/rlp` to 10.1.3, retaining the exact original pnpm dependency lock.
No research or fixture entrypoint is bundled.

## Rebuild the application payload

Use a fresh extracted source-kit directory, Windows x64 Node v24.19.0 and
pnpm 11.25.0 (the observed dependency installation tool). The Node executable
SHA256 is `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`.
It matches `win-x64/node.exe` in the official HTTPS checksum document at
https://nodejs.org/dist/v24.19.0/SHASUMS256.txt. The signed checksum document
has not been validated against an independently trusted release key. The
bootstrap locks the consumed esbuild 0.25.12 API and platform executable bytes.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir packaging/production-proof-dependencies install --ignore-workspace --frozen-lockfile --ignore-scripts
node scripts/bootstrap-production-payload.mjs build production-payload.lock.json new-production-payload
node --test scripts/test-production-payload-bootstrap.mjs
```

All output directories must be new. A changed compiler, source, dependency byte,
artifact set or output hash fails the locked build. Do not use `record-lock` to
silently accept a mismatch: that command makes a new review candidate and cannot
establish publisher trust. Linux toolchains need a separately reviewed platform
lock and acceptance; this Windows application lock does not pin a Linux OS.

The installer restores all root package dependencies from the existing frozen
application lock; it is not yet a minimized standalone dependency lock. It runs
with package lifecycle scripts disabled. Installed dependencies are excluded
from the source ZIP. Third-party distribution/source obligations are not waived.

## Registry correspondence verification

`verify-production-npm-closure.py LOCK NEW_CACHE NEW_REPORT` downloads package
tarballs only from HTTPS registry.npmjs.org, checks each against the frozen pnpm
SHA512 integrity and compares every consumed dependency file against the tarball.
It extracts no files and executes no downloaded code. Python 3.11 or newer is
required. It also rejects changed local inputs and conflicting duplicate copies.

The fresh report `outputs/production-npm-correspondence-20261016-r4.json` passed:
61 tarballs and 553 consumed dependency files matched. Its SHA256 is
`fa01bdbbc335bb047bf6f6bfeeeb29bfaac144f8432fb055d9d011c684f2028d`.
This establishes npm registry/lock byte correspondence, not independent security
review, npm publisher signature verification or an authenticated DriveKey release.

## Remaining OS and release prerequisites

This bootstrap closes a production application rebuild layer, not the historical
image ancestry. A fresh Linux assembler still needs authenticated pinned Debian
kernel/modules, Python/Tk/Pillow/Xorg/input/runtime packages, Node Linux runtime,
GRUB, squashfs/xorriso/filesystem tools, corresponding source/license closure,
and deterministic timestamps/identifiers. The existing interactive builder still
requires the original candidate squashfs and historical base. Those are listed
with exact hashes in `funds-release-provenance-2026-10-16.md`; they must not be
substituted or described as independently authenticated.

A maintainer-controlled release signing identity and independently established
public key, external security review, provider/guard approval, full transaction
acceptance and controlled physical/funded trials remain separate prerequisites.
No agent signing identity, public-chain operation or funding gate was introduced.
