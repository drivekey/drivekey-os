// Bounded PUBLIC IPC only. A worker reply never grants chain or signing authority.
import {createHash} from 'node:crypto';
import {getAddress, getBytes, getCreateAddress} from 'ethers';
import {z} from 'zod';
import {parseStrictPublicJson} from '../../core/strict-public-json';
import {parseSavingsHeaderInclusionFile, savingsHeaderProfileSchema, verifySavingsHeaderInclusion, SAVINGS_HEADER_WARNING} from '../../core/savings-header-inclusion';
import {savingsConfigSchema, savingsConfigHash, SAVINGS_USDC} from '../../core/savings-protocol';
import {SAVINGS_INCLUSION_LAYOUT_HASH} from '../../core/savings-inclusion-layout';
import {SAVINGS_V1_BUILD_IDENTITY} from '../../core/savings-enrollment';

export const PUBLIC_HEADER_PROOF_LIMITS = Object.freeze({inputBytes: 1048576, outputBytes: 16384});
const hash = z.string().regex(/^0x[0-9a-f]{64}$/), address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uint = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(n => BigInt(n) < (1n << 256n));
const uint64 = z.string().max(20).regex(/^(0|[1-9][0-9]*)$/).refine(n => BigInt(n) < (1n << 64n));
const authority = {headerAuthenticated: z.literal(false), chainAuthenticated: z.literal(false), canonicalityVerified: z.literal(false),
  consensusVerified: z.literal(false), finalityVerified: z.literal(false), freshnessVerified: z.literal(false), forkScheduleVerified: z.literal(false),
  receiptVerified: z.literal(false), currentStateAuthenticated: z.literal(false), deploymentReady: z.literal(false),
  signingReady: z.literal(false), fundingReady: z.literal(false), productionReady: z.literal(false)};
const headerSchema = z.object({schemaProfile: savingsHeaderProfileSchema, blockHash: hash, parentHash: hash, number: counter, timestamp: counter,
  stateRoot: hash, transactionRoot: hash, receiptRoot: hash, gasLimit: uint64, gasUsed: uint64, rawHeaderSha256: hash,
  hashMatchesSuppliedBytes: z.literal(true)}).strict();
const nonceSchema = z.object({nonce: uint, used: z.boolean()}).strict();
const stateSchema = z.object({vault: address, layoutHash: z.literal(SAVINGS_INCLUSION_LAYOUT_HASH),
  account: z.object({nonce: uint64, balance: uint, storageRoot: hash, codeHash: z.literal(SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash)}).strict(),
  configuration: savingsConfigSchema, configurationHash: hash, epoch: counter.min(1), paused: z.boolean(),
  threshold: z.union([z.literal(1), z.literal(2)]), withdrawalDelay: z.union([z.literal(300), z.literal(900)]),
  securityDelay: z.literal(3600), maxLifetime: z.literal(86400), usdc: z.literal(SAVINGS_USDC),
  pending: z.object({actionId: hash, queuedAt: counter, readyAt: counter, expiry: counter, epoch: counter,
    status: z.number().int().min(0).max(3), kind: z.number().int().min(0).max(2)}).strict(),
  nonceQueries: z.object({action: nonceSchema, protection: nonceSchema, configurationCancellation: nonceSchema}).strict(),
  provedExclusions: z.array(z.string().regex(/^(policy|configurationHash|signerCount|entered|signer:[0-2]|registered:[0-2]|actionNonce|protectionNonce|configurationCancellationNonce|pendingTimes|pendingStatus)$/)).max(15),
}).strict();
const deploymentSchema = z.object({derivedVault: address, deployer: address, nonce: counter, configuration: savingsConfigSchema,
  configurationHash: hash, runtimeCodeHash: z.literal(SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash), initCodeHash: hash,
  outcome: z.enum(['creation-succeeded-under-supplied-roots', 'creation-reverted-under-supplied-roots'])}).strict();
const receiptSchema = z.object({transactionIndex: counter, transactionHash: hash, caller: address, vault: address, actionId: hash.nullable(),
  operation: z.enum(['queue', 'execute', 'cancel', 'pause', 'protect', 'cancel-configuration', 'deploy']),
  receipt: z.object({type: z.literal(2), status: z.union([z.literal(0), z.literal(1)]), cumulativeGasUsed: uint64,
    logCount: z.number().int().min(0).max(16), rawReceiptSha256: hash}).strict(),
  matchedEffects: z.array(z.enum(['Queued', 'Withdrawn', 'Executed', 'ConfigurationApplied', 'Resumed', 'Cancelled', 'Paused'])).max(2),
  deployment: deploymentSchema.nullable()}).strict();
const resultSchema = z.object({status: z.literal('inclusion-consistent-under-supplied-header'),
  provenance: z.literal('self-consistent-supplied-execution-header-not-authenticated'), header: headerSchema,
  state: stateSchema.nullable(), receipt: receiptSchema.nullable(), stateRootBoundToSuppliedHeader: z.boolean(),
  rootPairBoundToSuppliedHeader: z.boolean(), timestampBoundToSuppliedHeader: z.literal(true), ...authority,
  warning: z.literal(SAVINGS_HEADER_WARNING)}).strict();
const replySchema = z.object({kind: z.literal('drivekey-savings-header-inclusion-reply'), version: z.literal(1), requestSha256: hash, result: resultSchema}).strict();
export function headerProofDigest(input: Uint8Array) {return '0x' + createHash('sha256').update(input).digest('hex');}
export function decodePublicHeaderProofReply(raw: Uint8Array, input: Uint8Array) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > PUBLIC_HEADER_PROOF_LIMITS.inputBytes) throw Error('Unsupported original header proof input.');
  if (!(raw instanceof Uint8Array) || !raw.byteLength || raw.byteLength > PUBLIC_HEADER_PROOF_LIMITS.outputBytes) throw Error('Unsupported header proof reply size.');
  const reply = replySchema.parse(parseStrictPublicJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw), PUBLIC_HEADER_PROOF_LIMITS.outputBytes));
  const r = reply.result, s = r.state, t = r.receipt, h = r.header;
  if (reply.requestSha256 !== headerProofDigest(input) || (!s && !t) || r.stateRootBoundToSuppliedHeader !== (s !== null) ||
      r.rootPairBoundToSuppliedHeader !== (t !== null) || BigInt(h.gasLimit) < 5000n || BigInt(h.gasLimit) >= (1n << 63n) || BigInt(h.gasUsed) > BigInt(h.gasLimit)) throw Error('Header proof reply context differs.');
  if (s) {
    const p = s.pending;
    if (s.configurationHash !== savingsConfigHash(s.configuration) || s.threshold !== (s.configuration.preset === 0 ? 1 : 2) ||
        s.withdrawalDelay !== (s.configuration.preset === 0 ? 300 : 900) || new Set(s.provedExclusions).size !== s.provedExclusions.length) throw Error('Header state reply policy differs.');
    if (p.status === 0 ? (p.queuedAt !== 0 || p.readyAt !== 0 || p.expiry !== 0 || p.epoch !== 0 || p.kind !== 0) :
      (!s.nonceQueries.action.used || p.epoch < 1 || p.epoch > s.epoch || p.queuedAt > h.timestamp || p.expiry <= p.readyAt || p.expiry > p.queuedAt + 86400 ||
       (p.kind === 0 ? ![300, 900].includes(p.readyAt - p.queuedAt) : p.readyAt - p.queuedAt !== 3600))) throw Error('Header state reply pending facts differ.');
    if (p.status !== 0 && p.epoch === s.epoch && p.kind === 0 && p.readyAt - p.queuedAt !== s.withdrawalDelay) throw Error('Header state reply delay differs.');
  }
  if (t) {
    const d = t.deployment, effects = t.matchedEffects, receipt = t.receipt;
    if (BigInt(receipt.cumulativeGasUsed) === 0n || BigInt(receipt.cumulativeGasUsed) > BigInt(h.gasUsed) ||
        (receipt.status === 0 && (receipt.logCount !== 0 || effects.length !== 0)) || (t.operation === 'deploy') !== (d !== null)) throw Error('Header receipt reply status differs.');
    if (d && (t.actionId !== null || effects.length !== 0 || receipt.logCount !== 0 || t.caller !== d.deployer || t.vault !== d.derivedVault ||
        getCreateAddress({from: d.deployer, nonce: d.nonce}) !== d.derivedVault || savingsConfigHash(d.configuration) !== d.configurationHash ||
        (d.outcome === 'creation-succeeded-under-supplied-roots') !== (receipt.status === 1))) throw Error('Header deployment reply identity differs.');
    if (!d) {
      if ((t.operation === 'pause' ? t.actionId !== null : t.operation !== 'protect' && t.actionId === null)) throw Error('Header receipt reply action differs.');
      if (receipt.status === 1) {
        const wanted = t.operation === 'queue' ? ['Queued'] : t.operation === 'pause' ? ['Paused'] : t.operation === 'execute' ? [effects[0], 'Executed'] :
          t.operation === 'protect' ? [t.actionId === null ? 'Paused' : 'Cancelled'] : ['Cancelled'];
        if (JSON.stringify(effects) !== JSON.stringify(wanted) || receipt.logCount < effects.length ||
            (t.operation === 'execute' && !['Withdrawn', 'ConfigurationApplied', 'Resumed'].includes(effects[0]))) throw Error('Header receipt reply effects differ.');
      }
    }
  }
  if (s && t && (s.vault !== t.vault || (t.actionId !== null && s.pending.actionId !== t.actionId))) throw Error('Header reply combines different vault/action facts.');
  return reply;
}
export async function verifyPublicHeaderProofEnvelope(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > PUBLIC_HEADER_PROOF_LIMITS.inputBytes) throw Error('Unsupported public header proof input.');
  const snapshot = Buffer.from(input), envelope = parseSavingsHeaderInclusionFile(snapshot), full = await verifySavingsHeaderInclusion(envelope), h = full.header;
  // Summarize prescribed facts. Never truncate raw logs or silently raise the IPC cap.
  const header = {schemaProfile: h.schemaProfile, blockHash: h.blockHash, parentHash: h.parentHash, number: h.number, timestamp: h.timestamp,
    stateRoot: h.stateRoot, transactionRoot: h.transactionRoot, receiptRoot: h.receiptRoot, gasLimit: h.gasLimit, gasUsed: h.gasUsed,
    rawHeaderSha256: headerProofDigest(getBytes(envelope.header.rawHeader)), hashMatchesSuppliedBytes: true as const};
  const receipt = full.receipt ? {...full.receipt, receipt: {type: full.receipt.receipt.type, status: full.receipt.receipt.status,
    cumulativeGasUsed: full.receipt.receipt.cumulativeGasUsed, logCount: full.receipt.receipt.logs.length,
    rawReceiptSha256: headerProofDigest(getBytes(envelope.receipt!.proof.rawReceipt))}} : null;
  const result = {...full, header, receipt};
  const output = Buffer.from(JSON.stringify({kind: 'drivekey-savings-header-inclusion-reply', version: 1, requestSha256: headerProofDigest(snapshot), result}));
  decodePublicHeaderProofReply(output, snapshot); return output;
}
