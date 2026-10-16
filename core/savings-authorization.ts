// Public export verification. A valid signature is not a queue/transaction receipt.
import {z} from 'zod';
import {getAddress, Signature, verifyTypedData} from 'ethers';
import {revalidateSavingsActionReview} from './savings-action-review';
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
export const savingsAuthorizationSchema = z.object({
  kind: z.literal('drivekey-savings-authorization'), version: z.literal(1), chainId: z.literal(1), contractVersion: z.literal(1),
  vault: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress),
  signer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress),
  fingerprint: hash, expectationFingerprint: hash, authorizationDigest: hash,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  submitted: z.literal(false), chainAuthenticated: z.literal(false), fundingReady: z.literal(false), productionReady: z.literal(false),
}).strict();
export function verifySavingsAuthorization(input: unknown, expectation: unknown, request: unknown, localSigner: string, fingerprint: string, now = Date.now()) {
  const response = savingsAuthorizationSchema.parse(input);
  const review = revalidateSavingsActionReview(expectation, request, localSigner, fingerprint, now);
  if (!review.typedData || !review.authorizationDigest) throw Error('Execution does not request a new savings signature.');
  if (response.fingerprint !== review.fingerprint || response.expectationFingerprint !== review.expectationFingerprint ||
      response.signer !== review.signer || response.authorizationDigest !== review.authorizationDigest ||
      response.vault !== review.typedData.domain.verifyingContract) throw Error('Signature does not match the exact reviewed action.');
  const signature = Signature.from(response.signature);
  if (signature.serialized.toLowerCase() !== response.signature.toLowerCase()) throw Error('Noncanonical signature.');
  const {domain, types, message} = review.typedData;
  if (getAddress(verifyTypedData(domain, types, message, signature)) !== review.signer) throw Error('Savings signature verification failed.');
  return response;
}
