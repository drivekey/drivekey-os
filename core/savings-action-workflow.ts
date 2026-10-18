// Public-data-only candidate workflow. No network, storage, signing or submission.
import {z} from 'zod';
import {getAddress, Interface, keccak256, toUtf8Bytes, ZeroAddress, ZeroHash} from 'ethers';
import {savingsActionSchema, savingsConfigSchema, savingsConfigHash, savingsActionHash, SAVINGS_ABI, SAVINGS_USDC, type SavingsAction} from './savings-protocol';
import {savingsReviewExpectationSchema, savingsActionReviewRequestSchema, reviewSavingsAction, type SavingsActionReviewRequest} from './savings-action-review';
import {savingsAuthorizationSchema, verifySavingsAuthorization} from './savings-authorization';
import {parseStrictPublicJson} from './strict-public-json';

const uint = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(value => BigInt(value) < 2n ** 256n, 'Integer overflow');
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress).refine(value => value !== ZeroAddress, 'Zero address');
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const asset = z.enum(['ETH', 'USDC']);
const tokenUnits = z.string().max(100).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const target = z.object({action: savingsActionSchema, newConfiguration: savingsConfigSchema.nullable()}).strict();
const queue = z.object({provenance: z.literal('host-rpc'), actionId: hash, queuedAt: counter, readyAt: counter, expiry: counter,
  epoch: counter.min(1), status: z.literal('queued')}).strict();
export const savingsActionIntentSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('withdraw'), asset, recipient: address, amount: tokenUnits, nonce: uint, expiry: counter}).strict(),
  z.object({kind: z.literal('configure'), newConfiguration: savingsConfigSchema, nonce: uint, expiry: counter}).strict(),
  z.object({kind: z.literal('resume'), nonce: uint, expiry: counter}).strict(),
  z.object({kind: z.literal('pause'), nonce: uint, expiry: counter}).strict(),
  z.object({kind: z.literal('cancel'), target, nonce: uint, expiry: counter}).strict(),
  z.object({kind: z.literal('execute'), target, queue}).strict(),
]);
export type SavingsActionIntent = z.infer<typeof savingsActionIntentSchema>;

/** Exact decimal conversion only; no floating-point amount or silent rounding. */
export function savingsTokenUnitsToBase(assetInput: unknown, amountInput: unknown): string {
  const symbol = asset.parse(assetInput), text = tokenUnits.parse(amountInput), decimals = symbol === 'ETH' ? 18 : 6;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw Error('Amount has more precision than this asset supports.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (amount <= 0n || amount >= 2n ** 256n) throw Error('Amount must be a positive uint256 value.'); return amount.toString();
}
export function prepareSavingsAction(expectedInput: unknown, intentInput: unknown, now = Date.now()): SavingsActionReviewRequest {
  const e = savingsReviewExpectationSchema.parse(expectedInput), intent = savingsActionIntentSchema.parse(intentInput);
  const currentConfigHash = savingsConfigHash(e.configuration);
  let operation: SavingsActionReviewRequest['operation'];
  if (intent.kind === 'execute') operation = {kind: 'execute', details: intent.target, queue: intent.queue};
  else if (intent.kind === 'pause' || intent.kind === 'cancel') {
    const protection = {kind: intent.kind === 'pause' ? 1 as const : 0 as const,
      actionId: intent.kind === 'pause' ? ZeroHash : savingsActionHash(e.vault, intent.target.action),
      nonce: intent.nonce, expiry: intent.expiry, epoch: e.epoch, currentConfigHash};
    operation = intent.kind === 'pause' ? {kind: 'protect', protection, target: null} : intent.target.action.kind === 1 ?
      {kind: 'cancel-configuration', protection, target: intent.target} : {kind: 'protect', protection, target: intent.target};
  } else {
    const a: SavingsAction = {kind: intent.kind === 'withdraw' ? 0 : intent.kind === 'configure' ? 1 : 2,
      asset: intent.kind === 'withdraw' && intent.asset === 'USDC' ? SAVINGS_USDC : ZeroAddress,
      recipient: intent.kind === 'withdraw' ? intent.recipient : ZeroAddress,
      amount: intent.kind === 'withdraw' ? savingsTokenUnitsToBase(intent.asset, intent.amount) : '0',
      nonce: intent.nonce, expiry: intent.expiry, epoch: e.epoch, currentConfigHash,
      newConfigHash: intent.kind === 'configure' ? savingsConfigHash(intent.newConfiguration) : ZeroHash};
    operation = {kind: 'queue', details: {action: a, newConfiguration: intent.kind === 'configure' ? intent.newConfiguration : null}};
  }
  const request = savingsActionReviewRequestSchema.parse({kind: 'drivekey-savings-action-review-request', version: 1, chainId: 1, contractVersion: 1,
    vault: e.vault, runtimeCodeHash: e.runtimeCodeHash, operation});
  // This public structural review does not choose an actual approving signer.
  reviewSavingsAction(e, request, e.configuration.signers[0], now); return request;
}

const assurances = {submitted: z.literal(false), chainAuthenticated: z.literal(false), receiptVerified: z.literal(false), finalityVerified: z.literal(false),
  fundingReady: z.literal(false), productionReady: z.literal(false), dryRunOnly: z.literal(true)};
const flags = {submitted: false, chainAuthenticated: false, receiptVerified: false, finalityVerified: false, fundingReady: false, productionReady: false, dryRunOnly: true} as const;
export const savingsApprovalCollectionSchema = z.object({kind: z.literal('drivekey-savings-approval-collection'), version: z.literal(1),
  workflowFingerprint: hash, authorizations: z.array(savingsAuthorizationSchema).max(2), ...assurances}).strict();
export type SavingsApprovalCollection = z.infer<typeof savingsApprovalCollectionSchema>;
function context(expectedInput: unknown, requestInput: unknown, now: number) {
  const expectation = savingsReviewExpectationSchema.parse(expectedInput), request = savingsActionReviewRequestSchema.parse(requestInput);
  const review = reviewSavingsAction(expectation, request, expectation.configuration.signers[0], now);
  const workflowFingerprint = keccak256(toUtf8Bytes(JSON.stringify({kind: 'drivekey-savings-public-workflow-v1', expectation, request})));
  return {expectation, request, review, workflowFingerprint};
}
function collectionContext(input: unknown, expected: unknown, request: unknown, now: number) {
  const c = savingsApprovalCollectionSchema.parse(input), current = context(expected, request, now);
  if (c.workflowFingerprint !== current.workflowFingerprint) throw Error('Savings identity or action changed. Start a new empty approval collection.');
  const seen = new Set<string>();
  const authorizations = c.authorizations.map(response => {
    if (seen.has(response.signer)) throw Error('Duplicate savings signer approval.'); seen.add(response.signer);
    const signerReview = reviewSavingsAction(current.expectation, current.request, response.signer, now);
    return verifySavingsAuthorization(response, current.expectation, current.request, response.signer, signerReview.fingerprint, now);
  });
  if (authorizations.length > current.review.requiredApprovals) throw Error('Too many approvals for this operation.');
  authorizations.sort((a, b) => BigInt(a.signer) < BigInt(b.signer) ? -1 : 1);
  return {...current, collection: {...c, authorizations}};
}
export function createSavingsApprovalCollection(expected: unknown, request: unknown, now = Date.now()): SavingsApprovalCollection {
  const c = context(expected, request, now);
  return {kind: 'drivekey-savings-approval-collection', version: 1, workflowFingerprint: c.workflowFingerprint, authorizations: [], ...flags};
}
/** Every update returns a fresh parsed collection and rechecks every approval. */
export function addSavingsAuthorization(input: unknown, expected: unknown, request: unknown, authorizationInput: unknown, now = Date.now()): SavingsApprovalCollection {
  const c = collectionContext(input, expected, request, now), authorization = savingsAuthorizationSchema.parse(authorizationInput);
  return collectionContext({...c.collection, authorizations: [...c.collection.authorizations, authorization]}, c.expectation, c.request, now).collection;
}
export function inspectSavingsApprovalCollection(input: unknown, expected: unknown, request: unknown, now = Date.now()) {
  const c = collectionContext(input, expected, request, now), requiredApprovals = c.review.requiredApprovals, collectedApprovals = c.collection.authorizations.length;
  return {workflowFingerprint: c.workflowFingerprint, expectationFingerprint: c.review.expectationFingerprint, purpose: c.review.purpose,
    requiredApprovals, collectedApprovals, remainingApprovals: requiredApprovals - collectedApprovals, canAssemble: collectedApprovals === requiredApprovals,
    signers: c.collection.authorizations.map(a => a.signer), ...flags,
    warning: 'Valid signatures establish key authorization only, not physical signer independence, current chain state, nonce availability, queue inclusion or funding safety.'};
}
const contract = new Interface(SAVINGS_ABI);
/** Exact restricted contract call only. Not a signed transaction or permission to broadcast. */
export function buildSavingsPreparedCall(expected: unknown, request: unknown, input: unknown, now = Date.now()) {
  const c = collectionContext(input, expected, request, now), o = c.request.operation, signatures = c.collection.authorizations.map(a => a.signature);
  if (signatures.length !== c.review.requiredApprovals) throw Error('The exact current approval threshold has not been collected.');
  let method: 'queue' | 'execute' | 'protect' | 'cancelConfiguration', args: unknown[];
  if (o.kind === 'queue') {method = 'queue'; args = [o.details.action, signatures];}
  else if (o.kind === 'execute') {method = 'execute'; args = [o.details.action, o.details.newConfiguration?.preset ?? 0, o.details.newConfiguration?.signers ?? []];}
  else if (o.kind === 'protect') {method = 'protect'; args = [o.protection, signatures[0]];}
  else {method = 'cancelConfiguration'; args = [o.protection, signatures];}
  return {kind: 'drivekey-savings-prepared-call' as const, version: 1 as const, chainId: 1 as const, contractVersion: 1 as const,
    to: c.expectation.vault, value: '0' as const, data: contract.encodeFunctionData(method, args), method, purpose: c.review.purpose,
    workflowFingerprint: c.workflowFingerprint, expectationFingerprint: c.review.expectationFingerprint,
    authorizationDigest: c.review.authorizationDigest, actionId: c.review.actionId, approvalCount: signatures.length,
    approvingSigners: c.collection.authorizations.map(a => a.signer), ...flags,
    warning: 'Unfunded candidate call data. Authorizations are transferable; this is not a signed gas-payer transaction or proof of queueing, execution or chain state. No broadcast is performed.'};
}
export type SavingsPreparedCall = ReturnType<typeof buildSavingsPreparedCall>;
/** Schemas reject cached readiness flags and arbitrary calls. Imported prepared
 * call data is deliberately not authority; rebuild it from verified inputs. */
export function parseSavingsActionWorkflowFile(text: string) {
  const value = parseStrictPublicJson(text, 32768);
  const parsed = z.union([savingsReviewExpectationSchema, savingsActionReviewRequestSchema, savingsActionIntentSchema,
    savingsAuthorizationSchema, savingsApprovalCollectionSchema]).parse(value);
  const limit = parsed.kind === 'drivekey-savings-approval-collection' ? 32768 : parsed.kind === 'drivekey-savings-authorization' ? 8192 : 16384;
  if (new TextEncoder().encode(text).length > limit) throw Error('Savings public file exceeds its purpose-specific bound.');
  return parsed;
}
