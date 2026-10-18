# Exact-image boot acceptance — 16 October 2026

The new one-USB `.img` passed isolated BIOS and expanded 31 GB UEFI boot,
actual Settings interactions and clean shutdown. A separate firmware-framebuffer
run without a serial UART reached the picker, empty desktop and clean shutdown.
These are VM results, not physical hardware or complete transaction acceptance.

Tested image: `interactive-20261016-r1792160000002-single-usb.img`,
1,073,741,824 bytes, SHA256
`48a0e09fc01a59ad9d4d864a90a1e3fc8d6c887a12d36abd32fedec38aab5c5e`.
The related ISO component has SHA256
`217e883050798bcbe61fe71f3a39c2a198bbc6c29248591e9e63e1a8c284139c`;
it is not separately accepted as a standalone transaction-testing distribution.

## Bound evidence

All paths below are relative to the source workspace. The sanitized evidence
archive records original paths, member names, byte lengths and hashes.

| Evidence | Path | SHA256 |
| --- | --- | --- |
| BIOS final result | `outputs/interactive-boot-single-usb-bios-1792163527064/result.json` | `f1f50ba21f6fac121660413f5b9e342023bba0e38c9221be16be83465e3b12c7` |
| UEFI final result | `outputs/interactive-boot-single-usb-uefi-1792163776591/result.json` | `470a53e66e1f9eea3a5897ca32fd1b56f891e52abd51100fd068a1bf1ed95c4d` |
| Framebuffer/no-UART result | `outputs/console-regression-ramfb-none-1792164086948/result.json` | `1171a5bdd792751edb477c59e0e10b33863e1ab7e4cecab1fac51da7930e3e71` |
| Read-only normal-run audit | `outputs/security-interactive-images/interactive-20261016-r1792160000002/interactive-smoke-evidence-audit.json` | `a115c33c44beb7ebd7d2aeaaee15a8b0fe9615c73c44409b69336e540dcbcdf9` |

The normal-run audit passed both reports against source/image identities,
recorded serial GUI states, actual pointer/keyboard traces, protected media
extents and stopped processes. BIOS and UEFI each have 13 reviewed screenshots,
26 total, covering the picker, empty desktop sections, Settings changes and
restoration, Escape/keyboard reopening/Done and shutdown confirmation. The
Settings click retries only on newly observed closed/idle states; the audit
checks each retry and preserves the exact bounded keyboard suffix.

No-UART acceptance uses five reviewed frames: `frame-050.png` (picker),
`frame-100.png` (idle empty desktop), `frame-131.png` (idle before retry),
`frame-161.png` (shutdown confirmation), and `guest-stopped.png`. The first
shutdown shortcut did not open the dialog; the recorded second request followed
another reviewed idle frame. Explicit confirmation produced QMP guest-shutdown,
final status `shutdown`, exit code zero, and a visible power-down message with
successful unmount. The harness then quit the already-stopped VM. Protected
bytes were unchanged; exchange contents were only an empty `DriveKey/` directory.
Settings was tested in the normal runs, not in this no-UART run.

Internal visual-review records are `outputs/funds-bios-visual-review-20261016.json`,
`outputs/funds-uefi-visual-review-20261016.json`, and
`outputs/funds-console-visual-review-20261016.json`. Their hashes are bound by the
separate `boot-release-evidence.json` and public archive manifest. Internal agent
review is not independent security review.

## Failed attempts retained

Earlier concurrent runs encountered memory pressure. The first UEFI VM was
intentionally stopped; a preliminary BIOS run reached the desktop but its
one-shot Settings click was not accepted, and a 60-second no-UART observation
reached only the picker. These are not counted as passes. Their result hashes
and failure descriptions remain in `preliminary-boot-attempts.json`; incomplete
visual review remains in `outputs/funds-incomplete-visual-review-20261016.json`.
Final runs used one QEMU at a time and eight-second normal screenshot settling.

The owner's earlier physical "it works" report applies to image
`interactive-20261016-r1792156250605`, not this new image. Fresh physical checks
remain required. Native wallet/transaction evidence is separately scoped and
does not convert boot acceptance into all-flow or real-funds readiness. No real
funds, public-chain broadcasts or physical disk writes occurred in these boot
campaigns; funding and authenticated-release gates remain false.
