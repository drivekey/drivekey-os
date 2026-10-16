// Exact read-only review. No private keys, transaction signing or submission.
import {z} from 'zod';
import {formatUnits, getAddress, keccak256, toUtf8Bytes, ZeroAddress} from 'ethers';
import {SAVINGS_V1_BUILD_IDENTITY} from './savings-enrollment';
import {savingsActionSchema, savingsProtectionSchema, savingsConfigSchema, savingsConfigHash,
  savingsActionHash, savingsProtectionHash, savingsDomain, validateSavingsAction,
  SAVINGS_ACTION_TYPES, SAVINGS_PROTECTION_TYPES, SAVINGS_USDC, type SavingsAction, type SavingsConfig} from './savings-protocol';
import {parseStrictPublicJson} from './strict-public-json';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress).refine(v => v !== ZeroAddress, 'Zero address');
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase());
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** The caller must establish this expectation independently of the request and
 * re-establish current policy after restore. It is NOT a chain attestation. */
export const savingsReviewExpectationSchema = z.object({
  kind: z.literal('drivekey-savings-review-expectation'), version: z.literal(1), chainId: z.literal(1), contractVersion: z.literal(1),
  vault: address, runtimeCodeHash: z.literal(SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash),
  configuration: savingsConfigSchema, epoch: counter.min(1), paused: z.boolean(),
}).strict().refine(e => !e.configuration.signers.includes(e.vault), 'Vault cannot sign for itself');
export type SavingsReviewExpectation = z.infer<typeof savingsReviewExpectationSchema>;
const actionDetails = z.object({action: savingsActionSchema, newConfiguration: savingsConfigSchema.nullable()}).strict();
const queueClaim = z.object({provenance: z.literal('host-rpc'), actionId: hash, queuedAt: counter, readyAt: counter,
  expiry: counter, epoch: counter.min(1), status: z.literal('queued')}).strict();
const operation = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('queue'), details: actionDetails}).strict(),
  z.object({kind: z.literal('execute'), details: actionDetails, queue: queueClaim}).strict(),
  z.object({kind: z.literal('protect'), protection: savingsProtectionSchema, target: actionDetails.nullable()}).strict(),
  z.object({kind: z.literal('cancel-configuration'), protection: savingsProtectionSchema, target: actionDetails}).strict(),
]);
export const savingsActionReviewRequestSchema = z.object({
  kind: z.literal('drivekey-savings-action-review-request'), version: z.literal(1), chainId: z.literal(1), contractVersion: z.literal(1),
  vault: address, runtimeCodeHash: hash, operation,
}).strict();
export type SavingsActionReviewRequest = z.infer<typeof savingsActionReviewRequestSchema>;
export function parseSavingsActionReviewFile(text: string) {
  return z.union([savingsReviewExpectationSchema, savingsActionReviewRequestSchema]).parse(parseStrictPublicJson(text, 16384));
}
const digestObject = (value: unknown) => keccak256(toUtf8Bytes(JSON.stringify(value)));
const presetName = (c: SavingsConfig) => c.preset === 0 ? 'Standard' : 'Strong';
const quorum = (c: SavingsConfig) => c.preset === 0 ? 1 : 2;
const withdrawalDelay = (c: SavingsConfig) => c.preset === 0 ? 300 : 900;
function utc(seconds: number) {
  const ms = seconds * 1000;
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8640000000000000) throw Error('Timestamp cannot be displayed exactly.');
  return new Date(ms).toISOString();
}
function details(input: z.infer<typeof actionDetails>, vault: string) {
  const a = input.action, next = input.newConfiguration;
  if (a.recipient === vault) throw Error('Vault cannot withdraw to itself.');
  if (a.kind === 1 ? !next || savingsConfigHash(next) !== a.newConfigHash || next.signers.includes(vault) : next !== null) throw Error('Full proposed signer configuration is missing or differs from its signed hash.');
  return a;
}
type Row = {label: string; value: string};
function actionRows(a: SavingsAction, next: SavingsConfig | null): Row[] {
  const rows: Row[] = [{label: 'Action', value: ['Withdraw', 'Change signers or preset', 'Resume vault'][a.kind]},
    {label: 'Asset address', value: a.asset}, {label: 'Recipient', value: a.recipient}, {label: 'Amount in base units', value: a.amount},
    {label: 'Action nonce', value: a.nonce}, {label: 'Action expiry UTC', value: utc(a.expiry)}, {label: 'Action expiry Unix seconds', value: String(a.expiry)},
    {label: 'Action policy epoch', value: String(a.epoch)}, {label: 'Action current configuration hash', value: a.currentConfigHash},
    {label: 'Action proposed configuration hash', value: a.newConfigHash}];
  if (a.kind === 0) {
    const symbol = a.asset === ZeroAddress ? 'ETH' : 'USDC', decimals = a.asset === ZeroAddress ? 18 : 6;
    // Symbol and precision are derived only from the two fixed contract assets.
    if (a.asset !== ZeroAddress && a.asset !== SAVINGS_USDC) throw Error('Unsupported savings asset.');
    rows.splice(1, 0, {label: 'Asset', value: symbol}, {label: 'Exact amount', value: formatUnits(a.amount, decimals) + ' ' + symbol});
  }
  if (next) rows.push({label: 'New preset', value: presetName(next)}, {label: 'New approval threshold', value: String(quorum(next))},
    ...next.signers.map((signer, i) => ({label: `New signer ${i + 1}`, value: signer})),
    {label: 'New withdrawal delay seconds', value: String(withdrawalDelay(next))});
  return rows;
}

/** localSigner is obtained by the caller from its independently selected local
 * public identity, never trusted from the imported request. The returned digest
 * is informational; every signing/funding/chain-assurance flag remains false. */
export function reviewSavingsAction(expectedInput: unknown, requestInput: unknown, localSigner: string, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) throw Error('Invalid review clock.');
  const expected = savingsReviewExpectationSchema.parse(expectedInput), request = savingsActionReviewRequestSchema.parse(requestInput);
  const signer = address.parse(localSigner), seconds = Math.floor(now / 1000), o = request.operation;
  if (request.vault !== expected.vault || request.runtimeCodeHash !== expected.runtimeCodeHash) throw Error('Request does not match the independently reviewed vault identity.');
  if (!expected.configuration.signers.includes(signer)) throw Error('Local signer is not registered in the reviewed current configuration.');
  const configurationHash = savingsConfigHash(expected.configuration), domain = savingsDomain(expected.vault);
  const rows: Row[] = [{label: 'Ethereum chain ID', value: '1'}, {label: 'Savings vault', value: expected.vault},
    {label: 'Contract version', value: '1'}, {label: 'Expected runtime code hash', value: expected.runtimeCodeHash},
    {label: 'This offline signer', value: signer}, {label: 'Current preset', value: presetName(expected.configuration)},
    {label: 'Current approval threshold', value: String(quorum(expected.configuration))},
    ...expected.configuration.signers.map((member, i) => ({label: `Current signer ${i + 1}`, value: member})),
    {label: 'Current policy epoch', value: String(expected.epoch)}, {label: 'Current configuration hash', value: configurationHash},
    {label: 'Current paused state', value: expected.paused ? 'Paused' : 'Not paused'}];
  let purpose: string, typedData: {domain: typeof domain; primaryType: 'Action' | 'Protection'; types: typeof SAVINGS_ACTION_TYPES | typeof SAVINGS_PROTECTION_TYPES; message: SavingsAction | z.infer<typeof savingsProtectionSchema>} | null = null;
  let authorizationDigest: string | null = null, actionId: string | null = null, requiredApprovals: number;
  let timing: {kind: 'new-queue-delay' | 'immediate-protection' | 'reported-existing-queue'; delaySeconds: number; expiry: number; readyAt: number | null; source: 'contract-rule' | 'untrusted-host-rpc'};
  if (o.kind === 'queue' || o.kind === 'execute') {
    const a = details(o.details, expected.vault); actionId = savingsActionHash(expected.vault, a);
    if (a.epoch !== expected.epoch || a.currentConfigHash !== configurationHash) throw Error('Action policy differs from the independently reviewed current policy.');
    const delay = a.kind === 0 ? withdrawalDelay(expected.configuration) : 3600;
    purpose = (o.kind === 'queue' ? 'Queue ' : 'Execute ') + ['withdrawal', 'configuration change', 'resume'][a.kind];
    rows.push(...actionRows(a, o.details.newConfiguration), {label: 'Exact action ID', value: actionId});
    if (o.kind === 'queue') {
      validateSavingsAction(expected.vault, a, expected.configuration, expected.epoch, expected.paused, now);
      authorizationDigest = actionId; requiredApprovals = quorum(expected.configuration);
      typedData = {domain, primaryType: 'Action', types: {Action: SAVINGS_ACTION_TYPES.Action.map(field => ({...field}))}, message: a};
      timing = {kind: 'new-queue-delay', delaySeconds: delay, expiry: a.expiry, readyAt: null, source: 'contract-rule'};
      rows.push({label: 'Delay after successful on-chain queue seconds', value: String(delay)},
        {label: 'Waiting period', value: 'Has not started. Signatures and file transfers do not start it.'});
    } else {
      const q = o.queue;
      if (q.actionId !== actionId || q.epoch !== expected.epoch || q.expiry !== a.expiry || q.readyAt !== q.queuedAt + delay || q.expiry <= q.readyAt || q.expiry > q.queuedAt + 86400 ||
          seconds < q.readyAt || seconds >= a.expiry || (a.kind === 0 && expected.paused) || (a.kind === 2 && !expected.paused)) throw Error('Reported queue is inconsistent, not ready, expired or unavailable.');
      requiredApprovals = 0;
      timing = {kind: 'reported-existing-queue', delaySeconds: delay, expiry: a.expiry, readyAt: q.readyAt, source: 'untrusted-host-rpc'};
      rows.push({label: 'Reported queue time UTC', value: utc(q.queuedAt)}, {label: 'Reported ready time UTC', value: utc(q.readyAt)},
        {label: 'Queue evidence', value: 'Untrusted host report; queueing, current state and finality are not authenticated.'},
        {label: 'New vault signature', value: 'None. A relayer can execute only if this exact action is already authorized and queued on-chain.'});
    }
  } else {
    const p = o.protection;
    if (p.epoch !== expected.epoch || p.currentConfigHash !== configurationHash || p.expiry <= seconds || p.expiry > seconds + 86400) throw Error('Protective approval has a stale policy or invalid expiry.');
    authorizationDigest = savingsProtectionHash(expected.vault, p);
    typedData = {domain, primaryType: 'Protection', types: {Protection: SAVINGS_PROTECTION_TYPES.Protection.map(field => ({...field}))}, message: p};
    timing = {kind: 'immediate-protection', delaySeconds: 0, expiry: p.expiry, readyAt: null, source: 'contract-rule'};
    if (p.kind === 1) {
      if (o.kind !== 'protect' || o.target !== null || expected.paused) throw Error('Pause requires an unpaused vault and no targeted action.');
      purpose = 'Pause vault'; requiredApprovals = 1;
      rows.push({label: 'Pause effect', value: 'Pause the vault and invalidate prior authorizations by advancing its policy epoch. Funds are not redirected.'});
    } else {
      if (!o.target) throw Error('Cancellation requires the complete targeted action.');
      const target = details(o.target, expected.vault); actionId = savingsActionHash(expected.vault, target);
      if (p.actionId !== actionId) throw Error('Protection target does not match the complete targeted action.');
      if (o.kind === 'cancel-configuration') {
        if (target.kind !== 1 || target.epoch !== expected.epoch || target.currentConfigHash !== configurationHash) throw Error('Quorum cancellation requires a current configuration change.');
        purpose = 'Cancel configuration change'; requiredApprovals = quorum(expected.configuration);
      } else {
        if (target.kind === 1) throw Error('Configuration cancellation requires the separate current-quorum route.');
        // An older/expired target can still be cancelled; do not confuse its
        // expiry with the new protective authorization's own absolute expiry.
        if (target.epoch > expected.epoch || (target.epoch === expected.epoch && target.currentConfigHash !== configurationHash)) throw Error('Target policy contradicts current enrollment expectation.');
        purpose = target.kind === 0 ? 'Cancel withdrawal' : 'Cancel resume'; requiredApprovals = 1;
      }
      rows.push({label: 'Cancellation effect', value: 'Cancel this exact action only. Funds are not redirected.'},
        {label: 'Target action ID', value: actionId}, ...actionRows(target, o.target.newConfiguration));
    }
    rows.push({label: o.kind === 'cancel-configuration' ? 'Configuration-cancellation nonce' : 'Protection nonce', value: p.nonce},
      {label: 'Protection expiry UTC', value: utc(p.expiry)}, {label: 'Protection expiry Unix seconds', value: String(p.expiry)},
      {label: 'Protection policy epoch', value: String(p.epoch)}, {label: 'Protection current configuration hash', value: p.currentConfigHash});
  }
  rows.unshift({label: 'Review purpose', value: purpose});
  rows.push({label: 'Approvals needed for this operation', value: String(requiredApprovals)},
    {label: 'Authorization digest', value: authorizationDigest ?? 'None: execution review does not request a new signature'});
  const expectationFingerprint = digestObject(expected);
  // Stable across re-review while still valid: the trusted clock is rechecked,
  // not used to manufacture a new deadline or change the approval fingerprint.
  const fingerprint = digestObject({kind: 'drivekey-savings-exact-review-v1', expectation: expected, request, signer, purpose, authorizationDigest, rows});
  return {kind: 'drivekey-savings-action-review' as const, version: 1 as const, fingerprint, expectationFingerprint, signer, purpose, rows,
    actionId, authorizationDigest, typedData, requiredApprovals, timing,
    expectationProvenance: 'caller-supplied-independent-review; origin is not authenticated by this function' as const,
    chainAuthenticated: false as const, receiptVerified: false as const, finalityVerified: false as const,
    fundingReady: false as const, productionReady: false as const, signingEnabled: false as const,
    warning: 'Read-only candidate review. It does not prove current chain state, unused nonces, queue inclusion, finality, physical signer independence or funding safety.'};
}
export type SavingsActionReview = ReturnType<typeof reviewSavingsAction>;
/** Future approval code must run this exact re-review before binding any output
 * to the fingerprint. This helper itself neither approves nor creates a signature. */
export function revalidateSavingsActionReview(expected: unknown, request: unknown, localSigner: string, fingerprint: string, now = Date.now()) {
  const reviewed = reviewSavingsAction(expected, request, localSigner, now);
  if (!/^0x[0-9a-f]{64}$/.test(fingerprint) || reviewed.fingerprint !== fingerprint) throw Error('Review purpose, signer, identity or exact action changed. Review again.');
  return reviewed;
}
