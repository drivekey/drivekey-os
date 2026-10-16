// Bounded public-only receipt proof IPC; this cannot authorize signing or funds.
import {createHash} from 'node:crypto';
import {getAddress, getBytes, getCreateAddress} from 'ethers';
import {z} from 'zod';
import {parseStrictPublicJson} from '../../core/strict-public-json';
import {savingsReceiptExpectationSchema, savingsReceiptInclusionProofSchema, savingsReceiptRootContextSchema,
  verifySavingsReceiptInclusion, SAVINGS_RECEIPT_WARNING} from '../../core/savings-receipt-inclusion';
import {savingsConfigSchema, savingsConfigHash} from '../../core/savings-protocol';
import {SAVINGS_V1_BUILD_IDENTITY} from '../../core/savings-enrollment';

export const PUBLIC_RECEIPT_PROOF_LIMITS = Object.freeze({inputBytes: 1048576, outputBytes: 16384});
const hash = z.string().regex(/^0x[0-9a-f]{64}$/), counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress);
const uint64 = z.string().max(20).regex(/^(0|[1-9][0-9]*)$/).refine(n => BigInt(n) < 2n ** 64n);
export const publicReceiptProofEnvelopeSchema = z.object({kind: z.literal('drivekey-savings-receipt-inclusion-envelope'), version: z.literal(1),
  suppliedRoots: savingsReceiptRootContextSchema, expected: savingsReceiptExpectationSchema, proof: savingsReceiptInclusionProofSchema}).strict();
export type PublicReceiptProofEnvelope = z.infer<typeof publicReceiptProofEnvelopeSchema>;
export function receiptProofDigest(input: Uint8Array) {return '0x' + createHash('sha256').update(input).digest('hex');}
function parse(raw: Uint8Array, bound: number) {
  if (!(raw instanceof Uint8Array) || raw.length === 0 || raw.length > bound) throw Error('Unsupported public receipt proof size.');
  return parseStrictPublicJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw), bound);
}
export function parsePublicReceiptProofEnvelope(raw: Uint8Array) {
  return publicReceiptProofEnvelopeSchema.parse(parse(raw, PUBLIC_RECEIPT_PROOF_LIMITS.inputBytes));
}
const deploymentSchema = z.object({derivedVault: address, deployer: address, nonce: counter, configuration: savingsConfigSchema,
  configurationHash: hash, runtimeCodeHash: z.literal(SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash), initCodeHash: hash,
  outcome: z.enum(['creation-succeeded-under-supplied-roots','creation-reverted-under-supplied-roots'])}).strict();
const resultSchema = z.object({status: z.enum(['matched-success-under-supplied-roots','matched-revert-under-supplied-roots']),
  provenance: z.literal('supplied-execution-root-pair-not-authenticated'), suppliedRoots: savingsReceiptRootContextSchema,
  transactionIndex: counter, transactionHash: hash, caller: address, vault: address, actionId: hash.nullable(),
  operation: z.enum(['queue','execute','cancel','pause','protect','cancel-configuration','deploy']),
  receipt: z.object({type: z.literal(2), status: z.union([z.literal(0), z.literal(1)]), cumulativeGasUsed: uint64,
    logCount: z.number().int().min(0).max(16), rawReceiptSha256: hash}).strict(),
  matchedEffects: z.array(z.enum(['Queued','Withdrawn','Executed','ConfigurationApplied','Resumed','Cancelled','Paused'])).max(2),
  deployment: deploymentSchema.nullable(), chainAuthenticated: z.literal(false), receiptVerified: z.literal(false), deploymentReady: z.literal(false),
  finalityVerified: z.literal(false), fundingReady: z.literal(false), productionReady: z.literal(false), signingReady: z.literal(false),
  currentStateAuthenticated: z.literal(false), rootPairBoundToHeader: z.literal(false), runtimeCodeVerified: z.literal(false), warning: z.literal(SAVINGS_RECEIPT_WARNING)}).strict();
const replySchema = z.object({kind: z.literal('drivekey-savings-receipt-inclusion-reply'), version: z.literal(1), requestSha256: hash, result: resultSchema}).strict();
export function decodePublicReceiptProofReply(raw: Uint8Array, input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.length === 0 || input.length > PUBLIC_RECEIPT_PROOF_LIMITS.inputBytes) throw Error('Unsupported original receipt proof input.');
  const reply = replySchema.parse(parse(raw, PUBLIC_RECEIPT_PROOF_LIMITS.outputBytes)), r = reply.result, deployed = r.deployment;
  if (reply.requestSha256 !== receiptProofDigest(input) || BigInt(r.receipt.cumulativeGasUsed) === 0n ||
    (r.status === 'matched-success-under-supplied-roots') !== (r.receipt.status === 1) ||
    (r.receipt.status === 0 && (r.receipt.logCount !== 0 || r.matchedEffects.length !== 0)) ||
    (r.operation === 'deploy') !== (deployed !== null)) throw Error('Receipt proof reply context differs.');
  if (deployed && (r.actionId !== null || r.matchedEffects.length !== 0 || r.receipt.logCount !== 0 || r.caller !== deployed.deployer || r.vault !== deployed.derivedVault ||
    getCreateAddress({from: deployed.deployer, nonce: deployed.nonce}) !== deployed.derivedVault || savingsConfigHash(deployed.configuration) !== deployed.configurationHash ||
    (deployed.outcome === 'creation-succeeded-under-supplied-roots') !== (r.receipt.status === 1))) throw Error('Deployment reply identity differs.');
  if (r.receipt.status === 1 && !deployed) {
    const wanted = r.operation === 'queue' ? ['Queued'] : r.operation === 'pause' ? ['Paused'] :
      r.operation === 'execute' ? [r.matchedEffects[0], 'Executed'] : r.operation === 'protect' ? [r.matchedEffects[0]] : ['Cancelled'];
    if (JSON.stringify(r.matchedEffects) !== JSON.stringify(wanted) || r.receipt.logCount < wanted.length ||
      (r.operation === 'execute' && !['Withdrawn','ConfigurationApplied','Resumed'].includes(r.matchedEffects[0])) ||
      (r.operation === 'protect' && !['Cancelled','Paused'].includes(r.matchedEffects[0]))) throw Error('Receipt proof reply effect differs.');
  }
  return reply;
}
export async function verifyPublicReceiptProofEnvelope(raw: Uint8Array) {
  const envelope = parsePublicReceiptProofEnvelope(raw), full = await verifySavingsReceiptInclusion(envelope.suppliedRoots, envelope.expected, envelope.proof);
  // Full raw logs can exceed 16KiB. Return only bounded interpreted effects and
  // a digest of exact receipt bytes, never silently truncate log data.
  const result = {...full, receipt: {type: full.receipt.type, status: full.receipt.status, cumulativeGasUsed: full.receipt.cumulativeGasUsed,
    logCount: full.receipt.logs.length, rawReceiptSha256: receiptProofDigest(getBytes(envelope.proof.rawReceipt))}};
  const output = Buffer.from(JSON.stringify({kind: 'drivekey-savings-receipt-inclusion-reply', version: 1, requestSha256: receiptProofDigest(raw), result}));
  decodePublicReceiptProofReply(output, raw); return output;
}
