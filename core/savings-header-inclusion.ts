// Public research only. A self-consistent supplied header is NOT an authenticated block.
import {z} from 'zod';
import {getBytes, hexlify, keccak256} from 'ethers';
import {RLP} from '../scripts/savings-inclusion-research/library';
import {parseStrictPublicJson} from './strict-public-json';
import {savingsInclusionQuerySchema, savingsInclusionProofSchema, verifySavingsStateInclusion} from './savings-inclusion';
import {savingsReceiptExpectationSchema, savingsReceiptInclusionProofSchema, verifySavingsReceiptInclusion} from './savings-receipt-inclusion';

export const SAVINGS_HEADER_LIMITS = Object.freeze({fileBytes: 1048576, headerBytes: 2048});
export const SAVINGS_HEADER_WARNING = 'The proofs and time are linked to one self-consistent supplied execution header. Its hash, fork profile and history are not independently trusted. This does not establish Ethereum chain identity, consensus, canonicality, finality, freshness, execution eligibility, or permission to sign or fund.';
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
export const savingsHeaderProfileSchema = z.enum(['shanghai', 'cancun', 'prague']);
export const savingsSuppliedHeaderSchema = z.object({kind: z.literal('drivekey-savings-supplied-execution-header'), version: z.literal(1),
  schemaProfile: savingsHeaderProfileSchema, claimedBlockHash: hash,
  rawHeader: z.string().max(2 + SAVINGS_HEADER_LIMITS.headerBytes * 2).regex(/^0x(?:[0-9a-f]{2})+$/)}).strict();
export type SavingsSuppliedHeader = z.infer<typeof savingsSuppliedHeaderSchema>;
export const savingsHeaderInclusionEnvelopeSchema = z.object({kind: z.literal('drivekey-savings-header-inclusion-envelope'), version: z.literal(1),
  header: savingsSuppliedHeaderSchema,
  state: z.object({query: savingsInclusionQuerySchema, proof: savingsInclusionProofSchema}).strict().nullable(),
  receipt: z.object({expected: savingsReceiptExpectationSchema, proof: savingsReceiptInclusionProofSchema}).strict().nullable(),
}).strict().refine(e => e.state !== null || e.receipt !== null, 'At least one exact proof is required.');
export type SavingsHeaderInclusionEnvelope = z.infer<typeof savingsHeaderInclusionEnvelopeSchema>;
export function parseSavingsHeaderInclusionFile(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > SAVINGS_HEADER_LIMITS.fileBytes) throw Error('Unsupported header-proof file size.');
  const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(input);
  return savingsHeaderInclusionEnvelopeSchema.parse(parseStrictPublicJson(text, SAVINGS_HEADER_LIMITS.fileBytes));
}
const authority = Object.freeze({headerAuthenticated: false as const, chainAuthenticated: false as const, canonicalityVerified: false as const,
  consensusVerified: false as const, finalityVerified: false as const, freshnessVerified: false as const, forkScheduleVerified: false as const,
  receiptVerified: false as const, currentStateAuthenticated: false as const, deploymentReady: false as const,
  signingReady: false as const, fundingReady: false as const, productionReady: false as const});

/** Canonical RLP/Keccak linkage only. No parent, body, consensus or fork-schedule validation. */
export function decodeSavingsSuppliedHeader(input: unknown) {
  const supplied = savingsSuppliedHeaderSchema.parse(input), raw = getBytes(supplied.rawHeader);
  const decoded = RLP.decode(raw);
  const count = {shanghai: 17, cancun: 20, prague: 21}[supplied.schemaProfile];
  if (!Array.isArray(decoded) || decoded.length !== count || decoded.some(v => !(v instanceof Uint8Array)) ||
      hexlify(RLP.encode(decoded)) !== supplied.rawHeader) throw Error('Unsupported or noncanonical execution-header tuple.');
  const fields = decoded as Uint8Array[];
  const fixed = (index: number, width: number) => {const value = fields[index];
    if (value.length !== width) throw Error('Invalid execution-header field width.'); return hexlify(value);};
  const scalar = (index: number, width: number) => {const value = fields[index];
    if (value.length > width || (value.length && value[0] === 0)) throw Error('Noncanonical execution-header scalar.');
    return value.length ? BigInt(hexlify(value)) : 0n;};
  const safe = (value: bigint) => {if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Unsupported execution-header counter precision.'); return Number(value);};
  const parentHash = fixed(0, 32), ommersHash = fixed(1, 32), beneficiary = fixed(2, 20), stateRoot = fixed(3, 32),
    transactionRoot = fixed(4, 32), receiptRoot = fixed(5, 32), logsBloom = fixed(6, 256), difficulty = scalar(7, 32),
    number = safe(scalar(8, 8)), gasLimit = scalar(9, 8), gasUsed = scalar(10, 8), timestamp = safe(scalar(11, 8)),
    extraData = hexlify(fields[12]), prevRandao = fixed(13, 32), nonce = fixed(14, 8), baseFeePerGas = scalar(15, 32), withdrawalsRoot = fixed(16, 32);
  if (ommersHash !== keccak256('0xc0') || difficulty !== 0n || nonce !== '0x0000000000000000' || fields[12].length > 32) throw Error('Unsupported post-merge header constants.');
  if (gasLimit < 5000n || gasLimit >= (1n << 63n) || gasUsed > gasLimit) throw Error('Invalid execution-header gas bounds.');
  let blobGasUsed: string | null = null, excessBlobGas: string | null = null, parentBeaconBlockRoot: string | null = null, requestsHash: string | null = null;
  if (supplied.schemaProfile !== 'shanghai') {
    const used = scalar(17, 8), excess = scalar(18, 8), maximum = supplied.schemaProfile === 'cancun' ? 786432n : 1179648n;
    if (used > maximum || used % 131072n || excess % 131072n) throw Error('Unsupported blob gas for the declared profile.');
    blobGasUsed = used.toString(); excessBlobGas = excess.toString(); parentBeaconBlockRoot = fixed(19, 32);
  }
  if (supplied.schemaProfile === 'prague') requestsHash = fixed(20, 32);
  const blockHash = keccak256(raw); if (blockHash !== supplied.claimedBlockHash) throw Error('Supplied header hash differs from exact RLP bytes.');
  return {schemaProfile: supplied.schemaProfile, blockHash, parentHash, number, timestamp, stateRoot, transactionRoot, receiptRoot,
    beneficiary, logsBloom, gasLimit: gasLimit.toString(), gasUsed: gasUsed.toString(), extraData, prevRandao,
    baseFeePerGas: baseFeePerGas.toString(), withdrawalsRoot, blobGasUsed, excessBlobGas, parentBeaconBlockRoot, requestsHash,
    hashMatchesSuppliedBytes: true as const, ...authority, warning: SAVINGS_HEADER_WARNING};
}

/** New versioned envelope; existing supplied-root proof formats are deliberately unchanged. */
export async function verifySavingsHeaderInclusion(input: unknown) {
  // Parsing copies the bounded public structures before any asynchronous work.
  const envelope = savingsHeaderInclusionEnvelopeSchema.parse(input);
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > SAVINGS_HEADER_LIMITS.fileBytes) throw Error('Header proof work exceeds the complete envelope bound.');
  const header = decodeSavingsSuppliedHeader(envelope.header);
  const state = envelope.state ? await verifySavingsStateInclusion(header.stateRoot, envelope.state.query, envelope.state.proof) : null;
  const receipt = envelope.receipt ? await verifySavingsReceiptInclusion({kind: 'drivekey-savings-supplied-root-pair', version: 1,
    transactionRoot: header.transactionRoot, receiptRoot: header.receiptRoot, blockTimestamp: header.timestamp}, envelope.receipt.expected, envelope.receipt.proof) : null;
  if (state && state.pending.status !== 0 && state.pending.queuedAt > header.timestamp) throw Error('Pending queue starts after the supplied header time.');
  if (receipt) {
    if (BigInt(receipt.receipt.cumulativeGasUsed) > BigInt(header.gasUsed)) throw Error('Receipt cumulative gas exceeds header gas used.');
    const blockBloom = getBytes(header.logsBloom), receiptBloom = getBytes(receipt.receipt.bloom);
    if (receiptBloom.some((b, i) => (b & blockBloom[i]) !== b)) throw Error('Receipt bloom is not included in header bloom.');
  }
  if (state && receipt && (state.vault !== receipt.vault || (receipt.actionId !== null && state.pending.actionId !== receipt.actionId))) throw Error('Combined proofs refer to a different vault or selected action.');
  // Copy proved facts only, rather than rewriting/promoting legacy authority flags.
  const stateFacts = state ? {vault: state.vault, layoutHash: state.layoutHash, account: state.account, configuration: state.configuration,
    configurationHash: state.configurationHash, epoch: state.epoch, paused: state.paused, threshold: state.threshold,
    withdrawalDelay: state.withdrawalDelay, securityDelay: state.securityDelay, maxLifetime: state.maxLifetime, usdc: state.usdc,
    pending: state.pending, nonceQueries: state.nonceQueries, provedExclusions: state.provedExclusions} : null;
  const receiptFacts = receipt ? {transactionIndex: receipt.transactionIndex, transactionHash: receipt.transactionHash, caller: receipt.caller,
    vault: receipt.vault, actionId: receipt.actionId, operation: receipt.operation, receipt: receipt.receipt,
    matchedEffects: receipt.matchedEffects, deployment: receipt.deployment} : null;
  return {status: 'inclusion-consistent-under-supplied-header' as const, provenance: 'self-consistent-supplied-execution-header-not-authenticated' as const,
    header, state: stateFacts, receipt: receiptFacts,
    stateRootBoundToSuppliedHeader: state !== null, rootPairBoundToSuppliedHeader: receipt !== null,
    timestampBoundToSuppliedHeader: true as const, ...authority, warning: SAVINGS_HEADER_WARNING};
}
