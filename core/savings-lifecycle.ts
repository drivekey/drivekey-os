// Read-only comparisons of host claims. Nothing in this module signs, submits,
// authenticates Ethereum consensus, or makes a deposit/funding recommendation.
import {z} from 'zod';
import {getAddress, Interface, Transaction, verifyTypedData, ZeroAddress} from 'ethers';
import {SAVINGS_ABI, SAVINGS_USDC, SAVINGS_PROTECTION_TYPES, savingsActionSchema, savingsConfigSchema,
  savingsProtectionSchema, savingsActionHash, savingsConfigHash, savingsDomain, verifySavingsApprovals,
  type SavingsAction} from './savings-protocol';
import {SAVINGS_V1_BUILD_IDENTITY} from './savings-enrollment';
import {parseStrictPublicJson} from './strict-public-json';

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase());
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress);
const nonzero = address.refine(v => v !== ZeroAddress, 'Zero address');
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const bytes = (max: number) => z.string().max(2 + max * 2).regex(/^0x(?:[0-9a-fA-F]{2})*$/).transform(v => v.toLowerCase());
const signature = z.string().regex(/^0x[0-9a-fA-F]{128}(?:1[bBcC])$/);
const block = z.object({number: counter, hash, timestamp: counter}).strict();
const actionFields = {action: savingsActionSchema, newConfiguration: savingsConfigSchema.nullable()};
const operation = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('queue'), ...actionFields, approvals: z.array(signature).min(1).max(2)}).strict(),
  z.object({kind: z.literal('execute'), ...actionFields}).strict(),
  z.object({kind: z.literal('cancel'), target: savingsActionSchema}).strict(),
  z.object({kind: z.literal('pause')}).strict(),
  z.object({kind: z.literal('protect'), protection: savingsProtectionSchema, target: savingsActionSchema.nullable(), approval: signature}).strict(),
  z.object({kind: z.literal('cancel-configuration'), protection: savingsProtectionSchema, target: savingsActionSchema, approvals: z.array(signature).min(1).max(2)}).strict(),
]);
export const savingsCallExpectationSchema = z.object({
  kind: z.literal('drivekey-savings-call-expectation'), version: z.literal(1), chainId: z.literal(1),
  vault: nonzero, configuration: savingsConfigSchema, epoch: counter.min(1), paused: z.boolean(),
  operation, rawTransaction: bytes(8192),
}).strict();
export type SavingsCallExpectation = z.infer<typeof savingsCallExpectationSchema>;
const logSchema = z.object({address, topics: z.array(hash).max(4), data: bytes(512), logIndex: counter,
  transactionHash: hash, blockNumber: counter, blockHash: hash, transactionIndex: counter, removed: z.boolean()}).strict();
export const savingsCallObservationSchema = z.object({
  kind: z.literal('drivekey-savings-call-observation'), version: z.literal(1), provenance: z.literal('host-rpc'), chainId: z.literal(1),
  transaction: z.object({rawTransaction: bytes(8192), block: block.nullable(), transactionIndex: counter.nullable()}).strict().nullable(),
  receipt: z.object({transactionHash: hash, status: z.union([z.literal(0), z.literal(1)]), block,
    transactionIndex: counter, logs: z.array(logSchema).max(16)}).strict().nullable(),
  canonicalReceiptBlock: block.nullable(),
}).strict();
export type SavingsCallObservation = z.infer<typeof savingsCallObservationSchema>;
const pendingSchema = z.object({actionId: hash, nonceUsed: z.boolean(), queuedAt: counter, readyAt: counter, expiry: counter, epoch: counter,
  status: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), kind: z.union([z.literal(0), z.literal(1), z.literal(2)])}).strict().refine(p =>
    p.status === 0 ? p.queuedAt === 0 && p.readyAt === 0 && p.expiry === 0 && p.epoch === 0 && p.kind === 0 :
      p.nonceUsed && p.epoch > 0 && p.readyAt > p.queuedAt && p.expiry > p.readyAt && p.expiry - p.queuedAt <= 86400,
    'Impossible pending mapping shape');
export const savingsStateObservationSchema = z.object({
  kind: z.literal('drivekey-savings-state-observation'), version: z.literal(1), provenance: z.literal('host-rpc'), chainId: z.literal(1),
  observedAt: z.string().datetime(), vault: nonzero, block, runtimeCodeHash: hash,
  configuration: savingsConfigSchema, configurationHash: hash, epoch: counter.min(1), paused: z.boolean(),
  pending: pendingSchema,
}).strict();
export type SavingsStateObservation = z.infer<typeof savingsStateObservationSchema>;
const evidencePair = z.object({expected: savingsCallExpectationSchema, observed: savingsCallObservationSchema}).strict();
export const savingsLifecycleInputSchema = z.object({kind: z.literal('drivekey-savings-lifecycle'), version: z.literal(1),
  queue: evidencePair, attempt: evidencePair.nullable(), current: savingsStateObservationSchema}).strict();
export type SavingsLifecycleInput = z.infer<typeof savingsLifecycleInputSchema>;
export function parseSavingsLifecyclePublicFile(text: string) {
  return z.union([savingsCallExpectationSchema, savingsCallObservationSchema, savingsStateObservationSchema, savingsLifecycleInputSchema])
    .parse(parseStrictPublicJson(text, 131072));
}

const iface = new Interface(SAVINGS_ABI), token = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const limits = {provenance: 'untrusted-host-rpc' as const, chainAuthenticated: false as const,
  receiptVerified: false as const, finalityVerified: false as const, fundingReady: false as const, productionReady: false as const};
function currentAction(a: SavingsAction, e: SavingsCallExpectation) {
  if (a.currentConfigHash !== savingsConfigHash(e.configuration) || a.epoch !== e.epoch || a.recipient === e.vault) throw Error('Expected action has a different vault policy.');
}
function protectionSigners(e: SavingsCallExpectation, approvals: string[]) {
  const o = e.operation;
  if (o.kind !== 'protect' && o.kind !== 'cancel-configuration') throw Error('Expected protective operation.');
  const p = o.protection;
  if (p.epoch !== e.epoch || p.currentConfigHash !== savingsConfigHash(e.configuration)) throw Error('Expected protection has a different policy.');
  const count = o.kind === 'protect' ? 1 : e.configuration.preset === 0 ? 1 : 2;
  if (approvals.length !== count) throw Error('Incorrect protective quorum.');
  const signers = approvals.map(s => getAddress(verifyTypedData(savingsDomain(e.vault), SAVINGS_PROTECTION_TYPES, p, s)));
  if (signers.some((s, i) => !e.configuration.signers.includes(s) || (i > 0 && BigInt(s) <= BigInt(signers[i - 1])))) throw Error('Unregistered, duplicate or unsorted protective signer.');
  return signers;
}
/** Validate an independently supplied expectation against existing PUBLIC signed
 * transaction bytes. Accepting a host-created expectation does not authenticate intent. */
export function inspectSavingsCall(input: unknown) {
  const expected = savingsCallExpectationSchema.parse(input), o = expected.operation;
  let data: string, action: SavingsAction | null = null, protectiveSigner: string | null = null;
  if (o.kind === 'queue' || o.kind === 'execute') {
    action = o.action; currentAction(action, expected);
    if (action.kind === 1 ? !o.newConfiguration || savingsConfigHash(o.newConfiguration) !== action.newConfigHash : o.newConfiguration !== null) throw Error('Proposed configuration does not match exact action.');
    if (o.kind === 'queue') {
      verifySavingsApprovals(expected.vault, action, expected.configuration, o.approvals);
      data = iface.encodeFunctionData('queue', [action, o.approvals]);
    } else data = iface.encodeFunctionData('execute', [action, o.newConfiguration?.preset ?? 0, o.newConfiguration?.signers ?? []]);
  } else if (o.kind === 'pause') data = iface.encodeFunctionData('pause');
  else if (o.kind === 'cancel') {
    action = o.target;
    if (action.kind === 1) throw Error('Configuration cancellation requires quorum.');
    data = iface.encodeFunctionData('cancel', [savingsActionHash(expected.vault, action)]);
  } else {
    action = o.target;
    const p = o.protection;
    if (p.kind === 1 ? action !== null : !action || p.actionId !== savingsActionHash(expected.vault, action)) throw Error('Protection target differs from its exact action.');
    if (o.kind === 'protect') {
      if (action?.kind === 1) throw Error('Configuration cancellation requires quorum.');
      protectiveSigner = protectionSigners(expected, [o.approval])[0];
      data = iface.encodeFunctionData('protect', [p, o.approval]);
    } else {
      if (p.kind !== 0 || action?.kind !== 1 || action.epoch !== expected.epoch) throw Error('Expected a current configuration cancellation.');
      protectionSigners(expected, o.approvals); protectiveSigner = ZeroAddress;
      data = iface.encodeFunctionData('cancelConfiguration', [p, o.approvals]);
    }
  }
  const transaction = Transaction.from(expected.rawTransaction);
  if (!transaction.isSigned() || transaction.type !== 2 || transaction.chainId !== 1n || transaction.to !== expected.vault || transaction.value !== 0n ||
      transaction.data !== data || transaction.serialized !== expected.rawTransaction || transaction.accessList?.length || !transaction.hash || !transaction.from) throw Error('Transaction bytes do not match the exact savings call.');
  if ((o.kind === 'cancel' || o.kind === 'pause') && !expected.configuration.signers.includes(transaction.from)) throw Error('Direct protection caller is not a registered signer.');
  if (o.kind === 'cancel' || o.kind === 'pause') protectiveSigner = transaction.from;
  return {expected, transactionHash: transaction.hash, caller: transaction.from, action,
    actionId: action ? savingsActionHash(expected.vault, action) : null, protectiveSigner};
}
type Call = ReturnType<typeof inspectSavingsCall>;
type CallStatus = 'not-seen' | 'submitted' | 'unavailable' | 'reorganized' | 'reverted' | 'observed';
type ExpectedEvent = {name: string; values: readonly unknown[]};
function eventsFor(call: Call, at: z.infer<typeof block>): ExpectedEvent[] {
  const e = call.expected, o = e.operation, a = call.action;
  if (o.kind === 'queue') {
    const delay = a!.kind === 0 ? e.configuration.preset === 0 ? 300 : 900 : 3600;
    if (a!.expiry <= at.timestamp + delay || a!.expiry > at.timestamp + 86400 || (a!.kind === 0 && e.paused) || (a!.kind === 2 && !e.paused)) throw Error('Successful queue contradicts its signed expiry or policy.');
    return [{name: 'Queued', values: [call.actionId, a!.kind, a!.nonce, a!.epoch, at.timestamp + delay, a!.expiry]}];
  }
  if (o.kind === 'execute') {
    if (at.timestamp >= a!.expiry || (a!.kind === 0 && e.paused) || (a!.kind === 2 && !e.paused)) throw Error('Successful execution contradicts expiry or paused state.');
    const effect: ExpectedEvent = a!.kind === 0 ? {name: 'Withdrawn', values: [call.actionId, a!.asset, a!.recipient, a!.amount]} :
      a!.kind === 1 ? {name: 'ConfigurationApplied', values: [a!.newConfigHash, o.newConfiguration!.preset, e.epoch + 1]} : {name: 'Resumed', values: [e.epoch + 1]};
    return [effect, {name: 'Executed', values: [call.actionId, a!.kind]}];
  }
  if (o.kind === 'protect' || o.kind === 'cancel-configuration') {
    if (o.protection.expiry <= at.timestamp || o.protection.expiry > at.timestamp + 86400) throw Error('Successful protection contradicts signed expiry.');
  }
  if (o.kind === 'pause' || (o.kind === 'protect' && o.protection.kind === 1)) {
    if (e.paused) throw Error('Repeated pause cannot succeed.');
    return [{name: 'Paused', values: [call.protectiveSigner, e.epoch + 1]}];
  }
  return [{name: 'Cancelled', values: [call.actionId, call.protectiveSigner]}];
}
function matchEvents(call: Call, observed: SavingsCallObservation) {
  const receipt = observed.receipt!, logs = receipt.logs;
  if (logs.some((l, i) => l.removed || l.transactionHash !== receipt.transactionHash || l.blockHash !== receipt.block.hash || l.blockNumber !== receipt.block.number || l.transactionIndex !== receipt.transactionIndex || (i > 0 && l.logIndex <= logs[i - 1].logIndex))) throw Error('Log provenance or ordering mismatch.');
  const own = logs.filter(l => l.address === call.expected.vault), wanted = eventsFor(call, receipt.block);
  if (own.length !== wanted.length) throw Error('Missing or extra savings events.');
  wanted.forEach((e, i) => {
    const encoded = iface.encodeEventLog(iface.getEvent(e.name)!, [...e.values]);
    if (own[i].data !== encoded.data.toLowerCase() || JSON.stringify(own[i].topics) !== JSON.stringify(encoded.topics.map(t => t.toLowerCase()))) throw Error('Savings event differs from exact authorized effect.');
  });
  if (call.expected.operation.kind === 'execute' && call.action?.kind === 0 && call.action.asset === SAVINGS_USDC) {
    const encoded = token.encodeEventLog(token.getEvent('Transfer')!, [call.expected.vault, call.action.recipient, call.action.amount]);
    const transfers = logs.filter(l => l.address === SAVINGS_USDC && l.topics[0] === encoded.topics[0].toLowerCase());
    if (transfers.length !== 1 || transfers[0].logIndex >= own[0].logIndex || transfers[0].data !== encoded.data.toLowerCase() || JSON.stringify(transfers[0].topics) !== JSON.stringify(encoded.topics.map(t => t.toLowerCase()))) throw Error('Canonical USDC transfer evidence is missing or differs.');
  }
}
function compare(call: Call, observed: SavingsCallObservation) {
  const result = (status: CallStatus, detail: string) => ({...limits, status, detail,
    transactionHash: call.transactionHash, actionId: call.actionId, operation: call.expected.operation.kind,
    block: status === 'observed' || status === 'reverted' ? observed.receipt!.block : null});
  if (!observed.transaction) return result(observed.receipt ? 'unavailable' : 'not-seen', 'No matching transaction observation.');
  if (observed.transaction.rawTransaction !== call.expected.rawTransaction) throw Error('Observed signed transaction bytes differ.');
  if (!observed.receipt) return result('submitted', 'Receipt unavailable; inclusion and effect are unverified.');
  const r = observed.receipt, tx = observed.transaction;
  if (r.transactionHash !== call.transactionHash) throw Error('Receipt transaction hash differs.');
  if (!tx.block || tx.transactionIndex === null) return result('unavailable', 'Transaction inclusion observation is incomplete.');
  if (JSON.stringify(tx.block) !== JSON.stringify(r.block) || tx.transactionIndex !== r.transactionIndex) throw Error('Transaction and receipt inclusion differ.');
  if (!observed.canonicalReceiptBlock) return result('unavailable', 'Canonical block observation unavailable.');
  if (observed.canonicalReceiptBlock.number !== r.block.number || observed.canonicalReceiptBlock.hash !== r.block.hash) return result('reorganized', 'Host observations no longer place this receipt in the canonical block.');
  if (observed.canonicalReceiptBlock.timestamp !== r.block.timestamp) throw Error('Block timestamp claims differ.');
  if (r.status === 0) {
    if (r.logs.length) throw Error('Reverted transaction cannot publish effect logs.');
    return result('reverted', 'Matching host receipt reports a reverted attempt, not an applied action.');
  }
  matchEvents(call, observed);
  return result('observed', 'Exact call and effect match host observations; Ethereum consensus and finality are not authenticated.');
}
export function compareSavingsCallObservation(expected: unknown, observed: unknown) {
  return compare(inspectSavingsCall(expected), savingsCallObservationSchema.parse(observed));
}
export type SavingsCallComparison = ReturnType<typeof compareSavingsCallObservation>;
export type SavingsEffectiveStatus = 'unknown' | 'not-queued' | 'waiting' | 'ready' | 'expired' | 'invalidated' | 'executed' | 'cancelled' | 'outcome-unverified';
export type SavingsLifecycleResult = typeof limits & {actionId: string | null; status: SavingsEffectiveStatus;
  queueObservation: CallStatus | 'invalid'; attemptObservation: CallStatus | null; observedBlock: z.infer<typeof block> | null;
  countdown: {readyAt: number; expiry: number; remainingAtObservedBlock: number} | null; reason: string};

/** Replace the previous UI snapshot with this result; never merge old countdowns
 * or success flags into it. Malformed/withdrawn/reorganized evidence fails closed.
 * A countdown is only an estimate relative to the HOST-REPORTED block timestamp. */
export function reduceSavingsLifecycle(input: unknown): SavingsLifecycleResult {
  let id: string | null = null, queueStatus: CallStatus | 'invalid' = 'invalid', attemptStatus: CallStatus | null = null;
  const result = (status: SavingsEffectiveStatus, reason: string, state: SavingsStateObservation | null = null,
    countdown: SavingsLifecycleResult['countdown'] = null): SavingsLifecycleResult => ({...limits, actionId: id, status, reason,
      queueObservation: queueStatus, attemptObservation: attemptStatus, observedBlock: state?.block ?? null, countdown});
  try {
    const s = savingsLifecycleInputSchema.parse(input), queue = inspectSavingsCall(s.queue.expected), current = s.current;
    if (queue.expected.operation.kind !== 'queue' || !queue.action) throw Error('Lifecycle must start with an exact queue expectation.');
    id = queue.actionId;
    const a = queue.action, q = compare(queue, s.queue.observed); queueStatus = q.status;
    if (current.vault !== queue.expected.vault || current.runtimeCodeHash !== SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash ||
        current.configurationHash !== savingsConfigHash(current.configuration) || current.pending.actionId !== id) throw Error('Host state identity differs from expected savings action.');
    if (q.status !== 'observed') return result(q.status === 'not-seen' && current.pending.status === 0 ? 'not-queued' : 'unknown', 'No current matching successful queue receipt. Any earlier countdown is withdrawn.');
    const qb = q.block!, pending = current.pending;
    if (current.block.number < qb.number || current.block.timestamp < qb.timestamp || (current.block.number === qb.number && (current.block.hash !== qb.hash || current.block.timestamp !== qb.timestamp))) throw Error('State predates or contradicts the observed queue block.');
    const delay = a.kind === 0 ? queue.expected.configuration.preset === 0 ? 300 : 900 : 3600;
    if (pending.status === 0 || !pending.nonceUsed || pending.queuedAt !== qb.timestamp || pending.readyAt !== qb.timestamp + delay ||
        pending.expiry !== a.expiry || pending.epoch !== a.epoch || pending.kind !== a.kind || current.epoch < a.epoch) throw Error('Pending action contradicts successful queue evidence.');
    if (current.epoch === a.epoch && (current.configurationHash !== a.currentConfigHash || current.paused !== queue.expected.paused)) throw Error('Policy or paused state changed without an epoch change.');
    let attempt: Call | null = null, evidence: SavingsCallComparison | null = null;
    if (s.attempt) {
      attempt = inspectSavingsCall(s.attempt.expected);
      if (attempt.expected.vault !== queue.expected.vault || attempt.expected.operation.kind === 'queue' || (attempt.actionId !== null && attempt.actionId !== id)) throw Error('Attempt targets a different vault or action.');
      evidence = compare(attempt, s.attempt.observed); attemptStatus = evidence.status;
      if (evidence.block && (evidence.block.number < qb.number || evidence.block.number > current.block.number || evidence.block.timestamp < qb.timestamp || evidence.block.timestamp > current.block.timestamp ||
          (evidence.block.number === qb.number && (evidence.block.hash !== qb.hash || evidence.block.timestamp !== qb.timestamp || s.attempt.observed.receipt!.transactionIndex <= s.queue.observed.receipt!.transactionIndex)) ||
          (evidence.block.number === current.block.number && (evidence.block.hash !== current.block.hash || evidence.block.timestamp !== current.block.timestamp)))) throw Error('Attempt block contradicts queue or current state.');
      if (evidence.status === 'reorganized' || evidence.status === 'unavailable' || evidence.status === 'submitted' || evidence.status === 'not-seen') return result('unknown', 'Attempt outcome is uncertain; earlier success and countdown are withdrawn.');
      if (evidence.status === 'observed') {
        const context = attempt.expected, contextHash = savingsConfigHash(context.configuration);
        // A successful call cannot use a future policy or fabricate a policy/
        // pause transition inside an unchanged epoch. Intermediate historical
        // epochs remain host claims; this is consistency, not chain proof.
        if (context.epoch < a.epoch || context.epoch > current.epoch ||
            (context.epoch === a.epoch && (contextHash !== a.currentConfigHash || context.paused !== queue.expected.paused)) ||
            (context.epoch === current.epoch && (contextHash !== current.configurationHash || context.paused !== current.paused))) throw Error('Successful attempt policy context contradicts queue or current state.');
        const o = attempt.expected.operation, isPause = o.kind === 'pause' || (o.kind === 'protect' && o.protection.kind === 1);
        if (isPause) {
          if (current.epoch < attempt.expected.epoch + 1 || (current.epoch === attempt.expected.epoch + 1 && (!current.paused || current.configurationHash !== savingsConfigHash(attempt.expected.configuration)))) throw Error('Pause side effects do not match current state.');
        } else if (o.kind === 'execute') {
          if (evidence.block!.timestamp < pending.readyAt || pending.status !== 2) throw Error('Executed claim precedes ready time or lacks executed state.');
          if (a.kind !== 0) {
            const expectedEpoch = a.epoch + 1;
            if (current.epoch < expectedEpoch) throw Error('Security action did not advance epoch.');
            if (current.epoch === expectedEpoch && (current.configurationHash !== (a.kind === 1 ? a.newConfigHash : a.currentConfigHash) || current.paused !== (a.kind === 1 ? attempt.expected.paused : false))) throw Error('Security action side effects do not match current state.');
          }
          return result('executed', 'Exact execution and effect match host observations; finality remains unverified.', current);
        } else {
          if (pending.status !== 3) throw Error('Cancellation effect lacks cancelled state.');
          return result('cancelled', 'Exact cancellation matches host observations; finality remains unverified.', current);
        }
      }
    }
    if (pending.status === 2 || pending.status === 3) return result('outcome-unverified', 'State claims a terminal action without the matching current operation receipt.', current);
    if (current.epoch !== a.epoch) return result('invalidated', 'Host state reports a newer policy epoch; this pending record is no longer executable.', current);
    if (current.block.timestamp >= a.expiry) return result('expired', 'Signed expiry has been reached according to the observed block timestamp.', current);
    if ((a.kind === 0 && current.paused) || (a.kind === 2 && !current.paused)) throw Error('Paused state contradicts an active action in the same epoch.');
    return result(current.block.timestamp < pending.readyAt ? 'waiting' : 'ready', evidence?.status === 'reverted' ?
      'The observed attempt reverted. The original queued action remains subject to its original delay and expiry.' : 'Successful queue observed. Waiting time comes from its block, not signatures or file timestamps.', current,
      {readyAt: pending.readyAt, expiry: a.expiry, remainingAtObservedBlock: Math.max(0, pending.readyAt - current.block.timestamp)});
  } catch {
    return result('unknown', 'Invalid or inconsistent savings evidence. Previous success and countdown must be withdrawn.');
  }
}
