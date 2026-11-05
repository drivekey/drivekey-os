# Private-note reservation boundary

Engineering implementation. Production private capabilities remain disabled;
this is not a complete note wallet, settlement or mainnet qualification.

An internal deterministic ownership manifest binds the complete original v28
request/public wallet to its canonical chain/asset, every owned input commitment,
nullifier, exact amount and encrypted-input hash, total private inputs and exact
change. The offline inspector derives the existing Hinkal identity from the fixed
wallet login, independently checks all supported 13/15/19/20/27 job semantics and
decrypts the original notes. It creates no circuit authorization, product approval
or transaction signature. Neither viewing/spending keys nor the login signature
are returned. The manifest's private note identifiers stay in privileged workers
and encrypted journals, outside renderer responses/logs/deliverables.

The final native financial review follows backup verification, passphrase unlock
and this read-only inspection. It displays independently decoded gross private
inputs and expected change in human-readable units and exact base units. No note
hold or irreversible signing attempt is created on cancellation. A new circuit
authorization follows the durable signing-attempt claim and encrypted note hold.
The final key-bearing authorization child derives the manifest again and checks
its exact fingerprint before R8. Whole requests/manifests are snapshotted across
asynchronous work. Existing completed response reuse creates no signature/claim.

Holds are indexed by actual commitments/nullifiers, not ciphertext hashes alone.
The other official encoding of the same note is blocked, as is a device metadata
alias for the same owner within one profile. Profile-wide reservation scanning
and a filesystem-exclusive encrypted lock prevent two concurrent claim writers.
Batch holds are immutable; failure or process death retains the lock and any
original/interrupted bytes. Orphan lock names also block new signing and key
reprovisioning. There is no automatic lock deletion after interruption and no
expiry/cancellation/reset/release endpoint.

Before a v29 chain signature, the exact original proof request must have its local
reservation. Its first complete chain request is bound immutably to that proof.
Another request/fee/nonce/approval for the same proof cannot obtain a replacement
signature. New detached legacy v10/v16/v18/v21 private transactions are rejected;
public approvals/revocations and non-private payment/bridge workflows keep their
existing separate rules. Old records remain readable. Missing note holds or chain
bindings block new wallet signing but do not discard original response recovery.

An online watch-only device may import a genuine remote proof authorization for
finalization, verification and recovery without inventing local signing state.
A key-bearing device must restore its authoritative note holds/bindings before
new private signing. Imported or historical authorization/signature records alone
cannot bootstrap that authority. This boundary does not solve whole-profile/vault
rollback, cross-profile/device key duplication or portable ledger restoration;
those remain explicit backup/device/recovery release gates.

New registered encrypted purposes are `private-note-claims`, `private-note-chains`
and `private-note-locks`. Missing, corrupt or wrong keys preserve records and fail
closed, including orphan locks. Journal directory/wallet/record symlink redirects
are refused; a Windows junction cannot masquerade as an empty profile during key
provisioning. Existing-purpose formats, keys, old releases and signed bytes are
not migrated, replaced or deleted.

Ownership inspection does not prove that a note remains unspent on its intended
mainnet. Independent discovery, current pool/root/nullifier validation, verified
recipient/output settlement and portable ledger/checkpoint restoration remain
required. Settled spent inputs must remain unavailable; safe failed/canceled
operation resolution needs independent evidence rather than age or an absent
receipt. This implementation deliberately provides no unverified release path.

Note reservation is not permission to spend money. The original protected
US$29.97 aggregate ceiling, remaining budget, gross-debit reservations before
funded signing and all route/fee/slippage/retry limits still apply independently.
No funding, retry, replacement or rebroadcast exception is introduced.

Local tests distinguish genuine unfunded owned-note/authorization/proof/chain
crypto from explicit journal-result/dialog doubles. Process-kill, concurrency,
alias, stale-clock, missing-state/key, corruption and Windows junction checks do
not qualify native approval/file handoffs, physical isolation, installed-MSIX,
current provider settlement or the original 24 intended-mainnet positive cases.
