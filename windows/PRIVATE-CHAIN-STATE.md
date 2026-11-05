# Private input chain-state boundary

Engineering implementation. Production private capabilities remain closed.
This is neither complete note discovery nor current-release live qualification.

Before private-chain preparation/signing handoff and again at explicit broadcast
preflight, Ethereum direct deposit/transfer/withdrawal and private-swap adapters
independently check the exact proof root/index and every nonzero input nullifier.
The online-only observer checks Ethereum identity, pinned non-proxy pool runtime,
canonical boolean ABI results, a fresh numbered head and its final canonical
hash. It checks the fixed block first, then pending state; pending deployment is
checked before and after the reads. A spent/pending-spent input, unknown root,
duplicate nullifier, changed runtime, proxy, stale/reorged head, malformed result
or outage prevents the handoff/submission. A simulation remains an additional
check. Exact public token balances, permissions, nonce, fees and calldata retain
their separate checks. Swap broadcast also revalidates original expiry after its
awaited preflight, immediately before the one explicit send.

Solana private-spend and private-swap account planning/preflight independently
derive the proof's root-bucket and nullifier PDAs. The observer checks genesis and
the pinned executable before and after state reads. It checks the Merkle account
discriminator/layout/version/minimum index/cursor, exact indexed 32-byte root,
root-bucket owner/size, and absence of all nonzero nullifier accounts. An existing
account at a nullifier PDA is rejected regardless of its owner or contents.
The full root bucket can be 10 MiB; only the exact indexed 32 bytes are fetched.

A fresh finalized block anchors the Solana observations. Merkle/nullifiers and
the sliced root use bounded monotonic confirmed-bank reads with minContextSlot;
the complete observation is repeated from at least the previous returned bank.
Regressed banks/cursors, wrong/missing roots, malformed encoding, wrong owners,
executable accounts, changed finalized head and outages are rejected. These
reads are not an atomic cross-bank proof. No state observer can lock a live chain
while the owner carries a request to another device. Existing blockhash/deadline,
exact rent/fee, simulation and explicit-submission checks therefore remain
mandatory; observations never promise that a later transaction cannot fail.

The observer receives public proof fields and performs public reads only. It
receives no vault/password/view/spending key, makes no signature, calls no send
method, and creates no release/reset/retry authority. The offline signer remains
network-denied and independently reconstructs ownership/proof semantics. Its
durable note reservations and first-chain bindings are separate invariants;
spent, uncertain or expired notes are never automatically released.

These preflight observations do not establish discovery completeness, owned
balance, recipient/change output settlement, a receipt or portable recovery.
Independent settlement and safe evidence-backed reservation resolution, complete
note/checkpoint transfer, whole-profile rollback and duplicate-key device controls
remain required. The original 24 installed-mainnet cases, real native/file
handoffs, separate offline device and all Store gates remain open.

Tests distinguish RPC doubles, retained negative fixtures, fresh synthetic
owned-note/proof/signature crypto and actual public mainnet reads. None of those
alone qualifies an installed-app mainnet payment/transfer/swap. The original
US$29.97 gross-debit ceiling, remaining ledger balance, reservation before funded
signing, explicit submission and no-funding/retry/replacement/rebroadcast rules
are unchanged. A successful state observation is not permission to spend.

Official contract semantics: [root membership](https://github.com/Hinkal-Protocol/Hinkal-Contracts-Circuits/blob/main/contracts/MerkleBase.sol),
[nullifier insertion](https://github.com/Hinkal-Protocol/Hinkal-Contracts-Circuits/blob/main/contracts/HinkalBase.sol),
[transaction checks](https://github.com/Hinkal-Protocol/Hinkal-Contracts-Circuits/blob/main/contracts/Hinkal.sol).
Solana layouts, PDA derivation and executable hashes use the existing pinned
official SDK/IDL/deployment provenance in vendor/hinkal; no provider pin changes.
