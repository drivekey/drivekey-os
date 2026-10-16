// Candidate savings authority path. No broadcaster or network state authentication.
import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes, writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseSavingsExpectationBytes, parseSavingsActionBytes, isolatedSavingsActionSignature} from './savings-action-isolation';
import {reviewSavingsAction, revalidateSavingsActionReview} from '../core/savings-action-review';
import {verifySavingsAuthorization} from '../core/savings-authorization';
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const command = z.discriminatedUnion('action', [
  z.object({scope: z.literal('savings-action'), action: z.literal('review')}).strict(),
  z.object({scope: z.literal('savings-action'), action: z.literal('sign'), fingerprint: hash, expectationFingerprint: hash,
    consent: z.literal(true), independentlyCheckedIdentity: z.literal(true), password: z.string().max(256)}).strict(),
]);
export async function savingsActionOfflineAction(input: unknown, directory: string) {
  const c = command.parse(input);
  await assertOfflineEnvironment();
  // Separate named expectation is still UNTRUSTED MEDIA. The operator must compare
  // it against independent enrollment/current-policy evidence, including after restore.
  const expectationBytes = await readBoundedExchangeBytes(directory, 'savings-review-expectation.json');
  const requestBytes = await readBoundedExchangeBytes(directory, 'savings-action-request.json');
  const vaultBytes = await readBoundedExchangeBytes(directory, 'vault-multi-encrypted.json');
  const expectation = await parseSavingsExpectationBytes(expectationBytes);
  const request = await parseSavingsActionBytes(requestBytes);
  const vault = await parseEncryptedVaultBytes(vaultBytes), signer = vault.public.evmAddress;
  const review = reviewSavingsAction(expectation, request, signer);
  const unchanged = async () => {
    for (const [filename, bytes] of [['savings-review-expectation.json', expectationBytes], ['savings-action-request.json', requestBytes], ['vault-multi-encrypted.json', vaultBytes]] as const) {
      if (!bytes.equals(await readBoundedExchangeBytes(directory, filename))) throw Error('Savings identity, action or encrypted vault changed. Review again.');
    }
    return revalidateSavingsActionReview(expectation, request, signer, review.fingerprint);
  };
  await unchanged();
  if (c.action === 'review') {
    // Do not export mutable typedData as a future signing capability.
    const {typedData: _, ...publicReview} = review;
    return {review: publicReview, identitySource: 'untrusted-media; independent comparison required' as const};
  }
  if (c.fingerprint !== review.fingerprint || c.expectationFingerprint !== review.expectationFingerprint) throw Error('Savings review or identity confirmation changed. Review again.');
  if (!review.typedData || !review.authorizationDigest) throw Error('This operation does not need a new savings signature.');
  await assertOfflineEnvironment();
  const signature = await isolatedSavingsActionSignature(expectation, request, vault, signer, review.fingerprint, c.password);
  // The secret-bearing child is dead before rereading media or publishing output.
  await assertOfflineEnvironment(); await unchanged();
  const authorization = verifySavingsAuthorization({kind: 'drivekey-savings-authorization', version: 1, chainId: 1, contractVersion: 1,
    vault: expectation.vault, signer: review.signer, fingerprint: review.fingerprint, expectationFingerprint: review.expectationFingerprint,
    authorizationDigest: review.authorizationDigest, signature, submitted: false, chainAuthenticated: false, fundingReady: false, productionReady: false},
    expectation, request, signer, review.fingerprint);
  await writeBoundedExchangeBytes(directory, 'savings-signed-authorization.json', Buffer.from(JSON.stringify(authorization, null, 2) + '\n'));
  return {authorization, message: 'Exact savings authorization saved. Not queued, executed or submitted.'};
}
