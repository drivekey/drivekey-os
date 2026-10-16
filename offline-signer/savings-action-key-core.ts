// KEY PROCESS ONLY: bounded binary input, no filesystem/media/JSON interface.
// The output is transferable classical vault authorization, not a setup proof.
// Candidate integration must remain unfunded until its separate acceptance gates.
import {getAddress, TypedDataEncoder, verifyTypedData} from 'ethers';
import {revalidateSavingsActionReview} from '../core/savings-action-review';
import {decodeSavingsActionSigningFrame, encodeSavingsActionSignature} from './savings-action-codec';
import {unlockMultiVault} from './multi-vault';

/** Consumes and clears the input frame. The caller must terminate the one-shot
 * key process after completion: JS password/private-key strings cannot be
 * reliably erased. This function cannot establish independent human review,
 * current chain state, physical signer independence or funding readiness. */
export async function signSavingsActionFrame(frame: Buffer): Promise<Buffer> {
  let keys: Awaited<ReturnType<typeof unlockMultiVault>> | undefined;
  let retainedSolSecret: Uint8Array | undefined;
  try {
    const {expectation, request, vault, signer, fingerprint, password} = decodeSavingsActionSigningFrame(frame);
    if (!['queue', 'protect', 'cancel-configuration'].includes(request.operation.kind))
      throw Error('This operation does not request a new vault authorization.');
    const review = () => {
      const result = revalidateSavingsActionReview(expectation, request, signer, fingerprint, Date.now());
      const typed = result.typedData;
      if (!typed || !result.authorizationDigest || result.requiredApprovals < 1 ||
          typed.primaryType !== (request.operation.kind === 'queue' ? 'Action' : 'Protection') ||
          TypedDataEncoder.hash(typed.domain, typed.types, typed.message) !== result.authorizationDigest)
        throw Error('Unsupported or inconsistent vault authorization purpose.');
      if (getAddress(vault.public.evmAddress) !== result.signer || !expectation.configuration.signers.includes(result.signer))
        throw Error('Selected local signer differs from the encrypted vault or current policy.');
      return {...result, typedData: typed};
    };
    const before = review(); // All identity/purpose/fingerprint checks precede decryption.
    keys = await unlockMultiVault(vault, password);
    // web3.js 1.98.4's public secretKey getter returns a COPY. Clear the actual
    // retained typed-array storage from this pinned implementation instead.
    // A changed dependency layout fails closed before any signature is made.
    const storage = Object.getOwnPropertyDescriptor(keys.sol, '_keypair')?.value;
    const secret = storage && Object.getOwnPropertyDescriptor(storage, 'secretKey')?.value;
    if (!(secret instanceof Uint8Array) || secret.byteLength !== 64) throw Error('Unsupported decrypted key storage.');
    retainedSolSecret = secret;
    if (keys.evm.address !== before.signer) throw Error('Unlocked key differs from the selected local signer.');
    // The KDF is asynchronous and may cross a deadline or leave too little queue delay.
    const current = review();
    const signature = await keys.evm.signTypedData(current.typedData.domain, current.typedData.types, current.typedData.message);
    const after = review(); // Recheck the absolute deadline after signing, without refreshing it.
    if (after.authorizationDigest !== before.authorizationDigest || after.fingerprint !== before.fingerprint ||
        getAddress(verifyTypedData(after.typedData.domain, after.typedData.types, after.typedData.message, signature)) !== keys.evm.address)
      throw Error('Produced signature does not match the exact reviewed authorization.');
    return encodeSavingsActionSignature(signature);
  } finally {
    retainedSolSecret?.fill(0);
    frame.fill(0);
  }
}
