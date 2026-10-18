# Assembly confinement fix review

Follow-up to the preserved r4 review: the updated assembler enters Bubblewrap before any copy, pruning or assembly writes. Its host tree is read-only, only a fresh staging tree is mounted writable at the fixed image parent, and its environment is cleared. The inner assembly rejects a writable root mount. Failed staging is retained and only a successful completed image tree is promoted. There is no command-line or environment flag to bypass the entrypoint wrapper.

Independently executed all 8 source-image tests successfully. In addition to input tampering checks and the author's namespace tests, this reviewer added relative-link escape denial, denial of writes through the original staging host-path alias, and absolute parent-link pruning/unlink denial. These exercise actual Bubblewrap operations with disposable files. The original unconfined primitive reproducer and r4 result remain preserved separately.

Reviewed assembler SHA256: `27814d74ad4263482c621bf947bd373bfa5da5eedc7770e85b76411e824b6bf6`.

Test SHA256: `345d14b879c40bde0ba67cf20a6692f67ddf1842f555e998b00972af1a0b5268`.

The identified host-write confinement defect is resolved in this source version. Network is deliberately shared to obtain the official Node archive/checksum; this is not a network-isolation claim. Read-only host access is not confidentiality confinement. The build trusts the host kernel, executable tools and checked source, and authenticated release/reproducibility limits remain. No fresh image build, VM boot, transaction or funds readiness is established by this review. A rebuilt candidate must bind this changed helper and repeat the acceptance prerequisites in the earlier review.
