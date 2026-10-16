# New exact-image candidate r1792174000006

The image was assembled from the frozen r6 application payload and the r9 signed-package base. It is a testing candidate, not an authenticated or accepted funded release.

Artifact directory: `/opt/drivekey-production-images/interactive-20261016-r1792174000006` in the Debian build environment.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `interactive-20261016-r1792174000006-single-usb.img` | 1,073,741,824 | `08425edbad312d58d30ac6aae7c262d6b8d8dc4e81c635ad612a20d859892889` |
| `interactive-20261016-r1792174000006-interactive.iso` | 253,763,584 | `dea13b4cdfb7d060956078212ed5368c86ceb2294b862130175ec9d07abaaf2c` |

The root agent independently ran `sha256sum` over both completed artifacts and matched the distribution records. The assembly record binds payload lock `6be7bf25d035369ff173bf645f19bd46d99aa114603c3c8ed5a61826b839d2aa` and base report `dfd79251bb7ce3d74c0d33c6c53436e22f6d1d2c38caa66834a2403653866a43`. The payload contains 35 workers and 114 artifacts, including separate WETH signing workers, LI.FI fee review, startup diagnostics and desktop refresh/exit-dialog fixes.

The one-USB partition table and exchange filesystem passed the packaging checks. These checks do not establish boot, signing, isolation or hardware acceptance. At this checkpoint the exact-image BIOS/UEFI/no-serial campaign is pending; older image evidence does not apply. Next transaction acceptance must create a fresh disposable wallet in this image, exercise backup/restore and sign wrap/unwrap requests through the actual desktop. Local EVM execution must consume those exact guest signatures to establish a stronger end-to-end result than source-key-core tests.

The build uses signed-base packing tools, but the release itself is unsigned, Secure Boot authentication is unproven, and Node's recorded checksum channel is not a verified PGP release signature. Independent security review and owner physical acceptance remain outstanding. No funds or public transactions were used. Later allowance-revocation source changes are outside this frozen candidate and require separately identified acceptance.
