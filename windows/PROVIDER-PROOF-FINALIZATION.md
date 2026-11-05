# Authenticated provider proof finalization

Engineering implementation; production private capabilities remain disabled.
This does not qualify a native handoff, physical signer separation, chain
transaction or Store release.

The online Windows app accepts an original v28 offline proof authorization only
for its retained request and complete public wallet. It verifies both the wallet
attestation and circuit signature. A valid imported signature cannot resolve an
unknown local signing attempt without the original response commitment.

A separate default-Cancel native review precedes an immutable encrypted
`proof-finalizations` claim. The network worker accepts only the public wallet,
request and existing authorization. It cannot accept a vault/password or dispatch
signing or submission. The pinned SDK encrypted handshake posts once to
`/finalize-tx` or `/finalize-solana-tx`; it does not use the provider's relay or
managed transaction-signing APIs. There is no retry/reset endpoint. An unresolved
provider attempt blocks every new signing authority and submission for that
wallet, while original read/re-export recovery remains available.

The result retains the provider's exact signed JSON envelope. Verification checks
the pinned response signer, duplicate-free bounded JSON, allowed fields, exact ABI
projection, and the separate public-signal array. It then reconstructs the
authorized root, output ciphertexts, canonical asset, amount, recipient, zero
relayer fees/hooks/permissions, calldata hash and signed-message hash. Groth16 is
verified locally using SHA-pinned verification keys. Proof coordinates are
bounded by the BN254 base field before curve conversion; public signals are
bounded by the scalar field. Invalid/zero points, an invalid G2 subgroup or pairing
equation fail closed. Ethereum and Solana profiles are 1x2x1, 1x2x2, 1x6x1 and
1x6x2. Solana retains recipient note acknowledgement checks.

Completed worker bytes are encrypted before UI-scope rechecks. A completed proof
delivered after expiry can be retained and recovered only when finalization began
within the original authorization lifetime. No timestamp/request is rewritten.
New finalization and every subsequent chain admission retain expiry checks.
Duplicate finalization and restart reuse the exact original result without a new
provider request or signature. Damaged, missing-key or mismatched journals are
preserved and disable new writes.

Verification-key provenance records the official contract commit and pinned SDK
artifact manifest. Deployment evidence compares all four registered Ethereum
wrapper/verifier runtimes at one common finalized block through two independent
RPCs, including repeated registration reads. Two independent Solana program-data
reads match the pinned deployment and all four keys' complete public point/IC
arrays. Initial extraction rows retain their earlier `deployedMatchVerified:false`
status; the later `deployments` evidence records the completed cross-check. This
snapshot does not replace fresh preflight or establish distribution licensing.

One fresh unfunded Ethereum deposit proof passed actual provider preparation,
offline circuit/wallet authorization with networking denied, one provider
finalization, exact envelope/semantic/Groth16 checks and encrypted restart
recovery. The requested amount was 1 wei; no transaction signature, funding or
broadcast was performed. Original encrypted synthetic state is retained outside
source and deliverables. Its public historical proof fixture contains no vault,
password or viewing/spending key and is excluded from application packages.
Historical fixture tests explicitly use recovery verification or a fixed local
fixture clock; they never contact a provider or claim fresh/mainnet success.

Fresh Solana provider finalization, provider-to-chain v29 admission for legacy
10/16 transactions, complete native note discovery/reservation/settlement,
recipient handoffs, installed-mainnet qualification and all release gates remain
unfinished. Existing local swap proofs follow their separate local proving path.

Relevant files: `online/hinkal-product-finalizer.ts`,
`engine/core/hinkal-provider-proof.ts`, `engine/core/hinkal-groth16.ts`,
`tools/provider-proof-worker.ts`, `tools/provider-finalizations.cjs`, and
`tools/native-provider-finalizer.cjs`. Public verification material is in
`vendor/hinkal/provider-verification-keys.json` and its provenance file. The
network worker ships only in Windows; both applications ship public proof
verification and preserve closed production policy.
