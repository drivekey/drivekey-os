# Internal source-OS and transaction review

This internal review covers the six new base/assembly/distribution/USB helpers and their two focused test files, plus the separate review-field source change. It is not an external security audit or release approval. No VM, real funds or public transaction submission was used by this review.

For r1792170000004, the four image-build artifact hashes and all eight recorded source hashes matched. The unchanged candidate policy validated all 8,340 entries of its root filesystem. Independently executed base confinement tests passed 4/4 and source input tests passed 4/4. The review record is `outputs/funds-source-os-r4-wallet-review-20261016.json`.

## Blocking build-host confinement finding

The reviewed assembler runs as host root. `checked_files` checks recorded symlink targets but permits a relative target outside the supplied root. The assembler then copies links and performs pruning, mkdir, copyfile and other writes before final candidate-policy validation. A late policy failure cannot undo writes through a parent symlink. Absolute links also exist during the initial udev pruning stage.

`scripts/review-production-source-r4.py` reproduces the write primitive using only temporary fixtures: a validated `opt -> ../outside` link survives copying, then the assembler's destination mkdir/copyfile operations write outside the copied root. It does not invoke the full assembler or alter external files. This is a confinement defect for crafted supplied inputs, not evidence of an escape in the actual r4 artifact, which passes final policy validation.

The release owner is addressing this by placing the whole assembly inside a namespace with only its newly created output writable. Required regression coverage includes a relative destination-parent link, an absolute pre-normalization pruning link, and rejection of any alternate writable host alias. Preserve the old source hashes and r4 evidence; a changed builder needs fresh bound build evidence.

## Integrity and reproducibility limits

The actual r4 content checks pass, but manifests are self-consistency records rather than authenticated releases. Node has an HTTPS checksum match, not verified release signatures. Host GRUB/build tools and the broader Debian closure still need the provenance work described by the release owner. Random FAT/GPT identifiers and unpinned build metadata mean byte reproducibility is not demonstrated by these checks. These limits are not solved by a successful boot.

## Exact-image wallet rerun prerequisites

1. Freeze the confinement fix, its negative tests, refreshed application source closure and workers containing the review-field changes. Assemble a new image and record its kernel, initramfs, squashfs, manifest, ISO and USB hashes. Neither old candidate acceptance nor r4 checks apply automatically to it.
2. Complete sequential BIOS, expanded UEFI, no-serial and Settings/shutdown checks on the exact new image before wallet execution. The release owner has the sole VM slot until handoff.
3. Use fresh disposable image copies, generated secrets and no NIC/host share. Run new create, public export, encrypted backup and restore first. The existing multichain runner requires successful same-image prior evidence, so do not reuse the old image's backup evidence or weaken that check.
4. Prepare fresh expiry-valid native ETH/SOL and ERC20/SPL requests from the new generated public identity. The current smoke layout reader accepts the unchanged manifest kind and geometry; its read-only full hash/GPT/FAT checks must pass on the new artifact before starting QEMU. Bind the exact runner, observation helper, fixtures and verifier hashes.
5. Review actual screens before approval: complete sender/recipient/network/asset/amount, gas limit and both fee caps, total fee, nonce, expiry/fingerprint and token code identity where applicable. Telemetry `idle=false` alone cannot distinguish a busy operation from a result or review screen. Use bounded observation plus visual inspection, with no automatic repeated signing.
6. Verify exact guest signatures and request/public/image hash binding, then rerun the local EVM/SVM execution and replay/nonce checks with frozen dependency locks. Synthetic state and local engine execution still do not prove public settlement or provider compatibility. Publish only sanitized summaries and reviewed screenshots; retain raw commands, wallets and signed payloads locally.

## Review-field source patch

Reviewed `multiReview` and `tradeReview`, the new protocol assertions and broker routing assertions. Fee fields come from the exact transaction after request validation. ERC20 code identity remains request-bound with metadata and upgrade caveats. No request mutation, fingerprint change, acceptance pin change or signing-policy weakening was found. No blocking finding remains in this scoped patch review.

All ten hashes in `outputs/funds-review-fields-source-evidence-20261016.json` match current files. Its recorded reports show 73 protocol and 87 broker passes; these were inspected, not re-executed by this reviewer. New negative cases reach the review validator with excessive gas limits. Source-only tests do not establish that longer review content is fully readable or scrollable on the new image; the exact-image visual checks above remain required.
