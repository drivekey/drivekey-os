# Independent review brief

This is a prepared request, not a sent message, engagement or audit claim. No reviewer has accepted the work and no cost or timetable is known.

## Request to send to a reviewer

We are preparing DriveKey OS, an offline USB wallet/signing environment. Please quote an independent review with explicit scope and deliverables against an immutable source/artifact manifest. Public work is at https://github.com/drivekey/drivekey-os/pull/1. The current candidate has local boot, wallet recovery and transaction-signing evidence; it is not approved for real funds.

Please scope two stages separately:

1. Review and independently reproduce the small Solana expiry guard, then assess the complete nonce/guard/provider integration. The prepared guard packet contains the exact five build inputs, 23,936-byte executable, tool versions, verifier sources, local execution references and unapproved deployment template. Required outcome: executable correspondence, findings with severity and remediation checks, and explicit acceptance or rejection of immutable deployment. Provider code provenance and upgrade governance must be separately resolved; a guard-only review does not approve swaps.
2. Review the wallet and release boundaries: entropy and key derivation, encrypted vault/backup/restore, removable-media isolation and hostile inputs, exact transaction review/signing, recipient/asset/network/fee enforcement, nonce/expiry/replay, uncertain submissions and recovery, source-to-image correspondence, release trust provisioning and rollback. Assess the advertised Ethereum, Solana and other supported routes individually. Identify any specialist OS or cryptography work outside your scope.

Please name the independent reviewers, record conflicts/control independence, bind your report to exact commits, source/build manifests and executable/image digests, and supply a final findings/retest report. Local agent tests and same-host reproducibility are engineering evidence, not an independent audit. A narrow review must not be described as acceptance of the entire product.

No seed phrases, private keys, real wallets or live signing data will be supplied. Initial reproduction uses disposable keys and isolated execution. No deployment or financial authorization is included in this request.

## Finding a reviewer without hiring a Solana developer

An independent security firm can quote this work directly. Two relevant starting points, verified from their own service pages on 16 October 2026, are [Neodyme's blockchain security and audit service](https://www.neodyme.io/en/blockchain/) and [OtterSec](https://osec.io/). These are options to contact, not claims that either has accepted DriveKey, is immediately available, or covers the entire OS/wallet scope. Obtain a written scope, quote and deliverables before commissioning work.

## Provider disclosure request

For the exact Jupiter and Raydium deployments in the provider handoff, request the source commit/archive, lockfiles, reproducible build/container/flags, full-allocation and trimmed executable hashes, deployment correspondence, and audit version. Request an explanation of the Raydium documented 24-hour delay versus the retained zero-delay configuration observation, including any independently enforced external control. Keep observed and accepted pins separate until review resolves the correspondence.

No request has been sent to maintainers or auditors. Sending one requires the owner's instruction; commissioning paid work requires agreed scope and budget. Completing that external review is a real dependency and cannot be replaced by relabeling internal checks.
