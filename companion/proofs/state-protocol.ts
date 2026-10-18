// Bounded PUBLIC research wire format. It cannot authorize a signature or funds.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {getAddress} from 'ethers';
import {parseStrictPublicJson} from '../../core/strict-public-json';
import {savingsConfigSchema, savingsConfigHash, SAVINGS_USDC} from '../../core/savings-protocol';
import {savingsInclusionQuerySchema, savingsInclusionProofSchema, verifySavingsStateInclusion} from '../../core/savings-inclusion';
import {SAVINGS_V1_BUILD_IDENTITY} from '../../core/savings-enrollment';
import {SAVINGS_INCLUSION_LAYOUT_HASH} from '../../core/savings-inclusion-layout';

export const PUBLIC_STATE_PROOF_LIMITS = Object.freeze({inputBytes: 1048576, outputBytes: 16384});
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uint = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(n => BigInt(n) < 2n ** 256n);
export const publicStateProofEnvelopeSchema = z.object({kind: z.literal('drivekey-savings-state-inclusion-envelope'),
  version: z.literal(1), suppliedRoot: hash, query: savingsInclusionQuerySchema, proof: savingsInclusionProofSchema}).strict();
export type PublicStateProofEnvelope = z.infer<typeof publicStateProofEnvelopeSchema>;
export function publicProofDigest(raw: Uint8Array) {return '0x' + createHash('sha256').update(raw).digest('hex');}
function parse(input: Uint8Array, max: number) {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > max) throw Error('Unsupported proof message size.');
  return parseStrictPublicJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(input), max);
}
export function parsePublicStateProofEnvelope(input: Uint8Array) {
  return publicStateProofEnvelopeSchema.parse(parse(input, PUBLIC_STATE_PROOF_LIMITS.inputBytes));
}
const nonce = z.object({nonce: uint, used: z.boolean()}).strict();
const resultSchema = z.object({status: z.literal('inclusion-consistent-under-supplied-root'),
  provenance: z.literal('supplied-execution-state-root-not-authenticated'), suppliedRoot: hash, vault: address,
  layoutHash: z.literal(SAVINGS_INCLUSION_LAYOUT_HASH),
  account: z.object({nonce: uint, balance: uint, storageRoot: hash, codeHash: z.literal(SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash)}).strict(),
  configuration: savingsConfigSchema, configurationHash: hash, epoch: counter.min(1), paused: z.boolean(),
  threshold: z.union([z.literal(1), z.literal(2)]), withdrawalDelay: z.union([z.literal(300), z.literal(900)]),
  securityDelay: z.literal(3600), maxLifetime: z.literal(86400), usdc: z.literal(SAVINGS_USDC),
  pending: z.object({actionId: hash, queuedAt: counter, readyAt: counter, expiry: counter, epoch: counter,
    status: z.number().int().min(0).max(3), kind: z.number().int().min(0).max(2)}).strict(),
  nonceQueries: z.object({action: nonce, protection: nonce, configurationCancellation: nonce}).strict(),
  provedExclusions: z.array(z.string().regex(/^(policy|configurationHash|signerCount|entered|signer:[0-2]|registered:[0-2]|actionNonce|protectionNonce|configurationCancellationNonce|pendingTimes|pendingStatus)$/)).max(15),
  chainAuthenticated: z.literal(false), finalityVerified: z.literal(false), receiptVerified: z.literal(false),
  fundingReady: z.literal(false), productionReady: z.literal(false), currentStateAuthenticated: z.literal(false), signingReady: z.literal(false),
  warning: z.literal('The root may be attacker-chosen or historical. Inclusion does not establish chain identity, block provenance, freshness, finality, deployment history, complete signer-map or pending-action enumeration, or permission to sign/fund.')}).strict();
const replySchema = z.object({kind: z.literal('drivekey-savings-state-inclusion-reply'), version: z.literal(1),
  requestSha256: hash, result: resultSchema}).strict();
export function decodePublicStateProofReply(raw: Uint8Array, input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > PUBLIC_STATE_PROOF_LIMITS.inputBytes) throw Error('Unsupported original proof input.');
  const reply = replySchema.parse(parse(raw, PUBLIC_STATE_PROOF_LIMITS.outputBytes)), r = reply.result;
  if (reply.requestSha256 !== publicProofDigest(input) || r.configurationHash !== savingsConfigHash(r.configuration) ||
    r.threshold !== (r.configuration.preset === 0 ? 1 : 2) || r.withdrawalDelay !== (r.configuration.preset === 0 ? 300 : 900) ||
    new Set(r.provedExclusions).size !== r.provedExclusions.length) throw Error('Public proof reply context mismatch.');
  return reply;
}
export async function verifyPublicStateProofEnvelope(raw: Uint8Array) {
  const request = parsePublicStateProofEnvelope(raw);
  const result = await verifySavingsStateInclusion(request.suppliedRoot, request.query, request.proof);
  const output = Buffer.from(JSON.stringify({kind: 'drivekey-savings-state-inclusion-reply', version: 1,
    requestSha256: publicProofDigest(raw), result}));
  // Revalidate the exact bytes that leave the worker, including its own schema.
  decodePublicStateProofReply(output, raw);
  return output;
}
