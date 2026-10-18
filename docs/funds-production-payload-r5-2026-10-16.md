# Updated offline review application payload

The r5 application payload incorporates the separately reviewed gas-cap and
token-code-hash display changes. It is not a new accepted OS release.

New payload lock: `outputs/production-payload-lock-20261016-r5.json`, SHA256
`66beb7a7c5bd5887788e8cb97cd587ced1be24e28cef499ffc660d0605856506`.
The locked build completed in `outputs/production-payload-20261016-r5` with
33 workers and 112 total artifacts. Compared with r4, only
`core/multi-protocol.ts` and `core/trade-protocol.ts` source hashes changed.
Only `opt/drivekey/drivekey-gui-worker.cjs` has different artifact bytes.
The compiler/runtime toolchain and all other application inputs match.

Source kit: `outputs/drivekey-production-source-kit-20261016-r5.zip`,
2,035,729 bytes, 242 members, SHA256
`6bf2d1d1fbc67be059b146f14e4033594a04e65d2aa387cdc293d5481d4c9363`.
This kit contains application sources and lockfiles, not the OS base or installed
dependencies. All older source kits and image evidence remain preserved.

The consumed dependency hash mapping exactly matches the 553 files previously
checked against 61 registry tarballs. The derivation record binds the old
correspondence report and both source-lock contexts. This is reuse of identical
dependency-byte evidence, not a fresh registry fetch or publisher authentication.

The root workspace locked build passed. A separately delegated extracted-kit
rebuild was stopped by automated safety review before producing a result.
Therefore fresh extracted-kit reproduction of r5 remains unverified. The
previous r4 reproduction result is not counted as an r5 rebuild.

Source validation remains 73 protocol and 87 broker tests. The r5 payload was
handed to the image builder for a distinct candidate after assembly confinement
review. No new boot, rendered-field, wallet or transaction acceptance is claimed
here. Independent review, authenticated release, provider readiness and explicit
bounded funded-trial authorization remain open.
