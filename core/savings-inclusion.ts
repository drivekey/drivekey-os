// Inclusion research ONLY. A supplied root is not Ethereum consensus evidence.
import {z} from 'zod';
import {AbiCoder, getAddress, getBytes, hexlify, keccak256, toBeHex, ZeroAddress} from 'ethers';
import {createMPTFromProof, createMerkleProof, RLP} from '../scripts/savings-inclusion-research/library';
import {savingsReviewExpectationSchema} from './savings-action-review';
import {savingsActionSchema, savingsActionHash, savingsConfigHash, savingsConfigSchema, SAVINGS_USDC} from './savings-protocol';
import {SAVINGS_V1_BUILD_IDENTITY} from './savings-enrollment';
import {SAVINGS_INCLUSION_LAYOUT_HASH} from './savings-inclusion-layout';
import {parseStrictPublicJson} from './strict-public-json';

export const SAVINGS_INCLUSION_LIMITS = Object.freeze({fileBytes: 1048576, slots: 32, nodesPerProof: 64, nodeBytes: 2048, runtimeBytes: 24576});
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress).refine(a => a !== ZeroAddress);
const uint = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(n => BigInt(n) < 2n ** 256n);
const bytes = (max: number) => z.string().max(2 + max * 2).regex(/^0x(?:[0-9a-f]{2})+$/);
const proofNodes = z.array(bytes(SAVINGS_INCLUSION_LIMITS.nodeBytes)).min(1).max(SAVINGS_INCLUSION_LIMITS.nodesPerProof);
export const savingsInclusionQuerySchema = z.object({kind: z.literal('drivekey-savings-inclusion-query'), version: z.literal(1),
  expectation: savingsReviewExpectationSchema, action: savingsActionSchema, protectionNonce: uint, configurationCancellationNonce: uint}).strict();
export type SavingsInclusionQuery = z.infer<typeof savingsInclusionQuerySchema>;
export const savingsInclusionProofSchema = z.object({kind: z.literal('drivekey-savings-state-proof'), version: z.literal(1), address,
  runtimeCode: bytes(SAVINGS_INCLUSION_LIMITS.runtimeBytes), accountProof: proofNodes,
  storageProof: z.array(z.object({key: hash, proof: proofNodes}).strict()).min(1).max(SAVINGS_INCLUSION_LIMITS.slots)}).strict();
export type SavingsInclusionProof = z.infer<typeof savingsInclusionProofSchema>;
export function parseSavingsInclusionFile(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.byteLength > SAVINGS_INCLUSION_LIMITS.fileBytes) throw Error('Oversized inclusion input.');
  const value = parseStrictPublicJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(input), SAVINGS_INCLUSION_LIMITS.fileBytes);
  return z.union([savingsInclusionQuerySchema, savingsInclusionProofSchema]).parse(value);
}
const word = (n: bigint | number) => toBeHex(n, 32);
const addSlot = (slot: string, increment: number) => word((BigInt(slot) + BigInt(increment)) % (1n << 256n));
const mapping = (type: 'address' | 'uint256' | 'bytes32', key: string, slot: number) => keccak256(AbiCoder.defaultAbiCoder().encode([type, 'uint256'], [key, slot]));
export function savingsInclusionSlots(input: unknown) {
  const q = savingsInclusionQuerySchema.parse(input), signers = q.expectation.configuration.signers, actionId = savingsActionHash(q.expectation.vault, q.action);
  const slots = [{name: 'policy', key: word(0)}, {name: 'configurationHash', key: word(1)}, {name: 'signerCount', key: word(2)}, {name: 'entered', key: word(8)}];
  for (let i = 0; i < signers.length; i++) {
    slots.push({name: `signer:${i}`, key: addSlot(keccak256(word(2)), i)}, {name: `registered:${i}`, key: mapping('address', signers[i], 3)});
  }
  const pending = mapping('bytes32', actionId, 7);
  slots.push({name: 'actionNonce', key: mapping('uint256', q.action.nonce, 4)}, {name: 'protectionNonce', key: mapping('uint256', q.protectionNonce, 5)},
    {name: 'configurationCancellationNonce', key: mapping('uint256', q.configurationCancellationNonce, 6)}, {name: 'pendingTimes', key: pending}, {name: 'pendingStatus', key: addSlot(pending, 1)});
  return slots;
}
function scalar(value: unknown, max = 32): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length > max || (value.length > 0 && value[0] === 0)) throw Error('Noncanonical scalar.'); return value;
}
function number(value: Uint8Array) {return value.length ? BigInt(hexlify(value)) : 0n;}
function safe(value: bigint) {if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Unsupported counter precision.'); return Number(value);}
type Rlp = Uint8Array | Rlp[];
function canonicalRlp(input: Uint8Array): Rlp {
  const value = RLP.decode(input) as Rlp;
  if (hexlify(RLP.encode(value)) !== hexlify(input)) throw Error('Noncanonical RLP.'); return value;
}
// Shape and hex-prefix canonicality checks around the maintained trie verifier.
// These do not implement trie traversal or hash verification.
function nodeShape(value: Rlp, depth = 0): void {
  if (depth > 64 || !Array.isArray(value) || ![2, 17].includes(value.length)) throw Error('Invalid trie node shape.');
  const reference = (child: Rlp, empty: boolean) => {
    if (Array.isArray(child)) {if (RLP.encode(child).length >= 32) throw Error('Oversized embedded trie node.'); nodeShape(child, depth + 1);}
    else if (child.length !== 32 && !(empty && child.length === 0)) throw Error('Invalid trie child reference.');
  };
  if (value.length === 17) {
    for (const child of value.slice(0, 16)) reference(child, true);
    if (!(value[16] instanceof Uint8Array) || value[16].length) throw Error('Secure-key branch value is unsupported.');
    if (value.slice(0, 16).filter(child => Array.isArray(child) || child.length > 0).length < 2) throw Error('Noncanonical single-child branch.');
  } else {
    const path = value[0]; if (!(path instanceof Uint8Array) || !path.length || path.length > 33) throw Error('Invalid compact path.');
    const flag = path[0] >> 4; if (flag > 3 || (!(flag & 1) && (path[0] & 15))) throw Error('Noncanonical compact path.');
    const nibbles = path.length * 2 - (flag & 1 ? 1 : 2); if (nibbles > 64 || (flag < 2 && nibbles === 0)) throw Error('Invalid compact path length.');
    if (flag < 2) reference(value[1], false); else if (!(value[1] instanceof Uint8Array) || value[1].length === 0) throw Error('Invalid leaf value.');
  }
}
/** Exact bounded proof path under a supplied root; no canonical-chain claim. */
export async function verifySavingsTrieProof(rootInput: string, rawKey: Uint8Array, nodeInputs: unknown) {
  const root = hash.parse(rootInput), nodes = proofNodes.parse(nodeInputs);
  if (!(rawKey instanceof Uint8Array) || ![20, 32].includes(rawKey.length)) throw Error('Only raw account/slot keys are supported.');
  const proof = nodes.map(node => {const b = getBytes(node); nodeShape(canonicalRlp(b)); return b;});
  if (new Set(nodes).size !== nodes.length) throw Error('Duplicate proof node.');
  const trie = await createMPTFromProof(proof, {root: getBytes(root), useKeyHashing: true});
  if (hexlify(trie.root()) !== root) throw Error('Proof root substitution.');
  const value = await trie.get(rawKey, true);
  // Geth-compatible minimal representation: root plus hash-referenced nodes.
  // Embedded children are already committed inside their parent, not repeated.
  const path = await createMerkleProof(trie, rawKey);
  let depth = 0;
  for (const [i, encoded] of path.entries()) {
    const node = canonicalRlp(encoded) as Rlp[];
    if (node.length === 17) {if (depth >= 64) throw Error('Secure trie path exceeds its key width.'); if (i < path.length - 1) depth++;}
    else {const compact = node[0] as Uint8Array, flag = compact[0] >> 4; depth += compact.length * 2 - (flag & 1 ? 1 : 2);
      if (depth > 64 || (flag >= 2 && depth !== 64)) throw Error('Secure trie leaf has the wrong path width.');
      if (flag < 2 && i < path.length - 1 && (canonicalRlp(path[i + 1]) as Rlp[]).length !== 17) throw Error('Noncanonical extension target.');}
  }
  const consumed = path.filter((node, index) => index === 0 || node.length >= 32).map(hexlify);
  if (JSON.stringify(consumed) !== JSON.stringify(nodes)) throw Error('Extra, unused, missing or noncanonical proof path.');
  return value;
}
export async function verifySavingsStateInclusion(suppliedRootInput: unknown, queryInput: unknown, proofInput: unknown) {
  const suppliedRoot = hash.parse(suppliedRootInput), q = savingsInclusionQuerySchema.parse(queryInput), p = savingsInclusionProofSchema.parse(proofInput), e = q.expectation;
  const total = p.runtimeCode.length / 2 + p.accountProof.reduce((n, s) => n + s.length / 2, 0) + p.storageProof.reduce((n, s) => n + s.proof.reduce((sum, x) => sum + x.length / 2, 0), 0);
  if (total > SAVINGS_INCLUSION_LIMITS.fileBytes) throw Error('Inclusion work exceeds total byte bound.');
  if (p.address !== e.vault || keccak256(p.runtimeCode) !== SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash) throw Error('Vault or code substitution.');
  const leaf = await verifySavingsTrieProof(suppliedRoot, getBytes(e.vault), p.accountProof);
  if (leaf === null) throw Error('Expected savings account is absent under supplied root.');
  const account = canonicalRlp(leaf);
  if (!Array.isArray(account) || account.length !== 4) throw Error('Invalid account tuple.');
  const accountNonce = number(scalar(account[0], 8)), balance = number(scalar(account[1]));
  if (!(account[2] instanceof Uint8Array) || account[2].length !== 32 || !(account[3] instanceof Uint8Array) || account[3].length !== 32) throw Error('Invalid account commitment widths.');
  const storageRoot = hexlify(account[2]), codeHash = hexlify(account[3]);
  if (codeHash !== e.runtimeCodeHash || codeHash !== keccak256(p.runtimeCode)) throw Error('Proved account code differs from pinned savings code.');
  const slots = savingsInclusionSlots(q), requested = new Map(p.storageProof.map(s => [s.key, s]));
  if (requested.size !== p.storageProof.length || requested.size !== slots.length || slots.some(s => !requested.has(s.key))) throw Error('Missing, duplicate or unrequested storage slot.');
  const values = new Map<string, bigint>(), excluded: string[] = [];
  for (const slot of slots) {
    const value = await verifySavingsTrieProof(storageRoot, getBytes(slot.key), requested.get(slot.key)!.proof);
    if (value === null) {values.set(slot.name, 0n); excluded.push(slot.name);}
    else {const decoded = scalar(canonicalRlp(value)); if (!decoded.length) throw Error(`Stored zero is not canonical Ethereum storage (${slot.name}).`); values.set(slot.name, number(decoded));}
  }
  const value = (name: string) => values.get(name)!;
  const boolean = (name: string) => {const n = value(name); if (n !== 0n && n !== 1n) throw Error('Invalid stored boolean.'); return n === 1n;};
  const policy = value('policy'), preset = Number(policy & 255n), epoch = safe((policy >> 8n) & ((1n << 64n) - 1n)), pausedByte = Number((policy >> 72n) & 255n);
  if (policy >> 80n || preset > 1 || epoch < 1 || pausedByte > 1 || value('entered') !== 0n) throw Error('Invalid packed savings policy.');
  if (value('signerCount') !== BigInt(e.configuration.signers.length)) throw Error('Signer count differs from expected current policy.');
  const signers = e.configuration.signers.map((_, i) => {const n = value(`signer:${i}`); if (n === 0n || n >> 160n || !boolean(`registered:${i}`)) throw Error('Invalid stored signer or registration.'); return getAddress(toBeHex(n, 20));});
  const configuration = savingsConfigSchema.parse({preset, signers}), configurationHash = word(value('configurationHash'));
  if (configurationHash !== savingsConfigHash(configuration) || configurationHash !== savingsConfigHash(e.configuration) || epoch !== e.epoch || Boolean(pausedByte) !== e.paused) throw Error('Proved policy differs from the exact supplied expectation.');
  const times = value('pendingTimes'), statusWord = value('pendingStatus'), status = Number(statusWord & 255n), kind = Number((statusWord >> 8n) & 255n);
  const mask = (1n << 64n) - 1n, queuedAt = safe(times & mask), readyAt = safe((times >> 64n) & mask), expiry = safe((times >> 128n) & mask), pendingEpoch = safe(times >> 192n);
  if (statusWord >> 16n || status > 3 || kind > 2) throw Error('Invalid packed pending state.');
  const actionNonceUsed = boolean('actionNonce'), protectionNonceUsed = boolean('protectionNonce'), configurationCancellationNonceUsed = boolean('configurationCancellationNonce');
  if (status === 0 ? (times !== 0n || statusWord !== 0n) : (!actionNonceUsed || pendingEpoch < 1 || pendingEpoch > epoch || pendingEpoch !== q.action.epoch || expiry !== q.action.expiry || kind !== q.action.kind ||
      expiry <= readyAt || expiry > queuedAt + 86400 || (kind === 0 ? ![300, 900].includes(readyAt - queuedAt) : readyAt - queuedAt !== 3600))) throw Error('Pending action facts are inconsistent.');
  if (status !== 0 && pendingEpoch === epoch && q.action.currentConfigHash !== configurationHash) throw Error('Pending configuration differs from same-epoch policy.');
  if (status !== 0 && pendingEpoch === epoch && kind === 0 && readyAt - queuedAt !== (preset === 0 ? 300 : 900)) throw Error('Pending delay differs from current policy.');
  return {status: 'inclusion-consistent-under-supplied-root' as const, provenance: 'supplied-execution-state-root-not-authenticated' as const,
    suppliedRoot, vault: e.vault, layoutHash: SAVINGS_INCLUSION_LAYOUT_HASH, account: {nonce: accountNonce.toString(), balance: balance.toString(), storageRoot, codeHash},
    configuration, configurationHash, epoch, paused: Boolean(pausedByte), threshold: preset === 0 ? 1 : 2, withdrawalDelay: preset === 0 ? 300 : 900,
    securityDelay: 3600, maxLifetime: 86400, usdc: SAVINGS_USDC, pending: {actionId: savingsActionHash(e.vault, q.action), queuedAt, readyAt, expiry, epoch: pendingEpoch, status, kind},
    nonceQueries: {action: {nonce: q.action.nonce, used: actionNonceUsed}, protection: {nonce: q.protectionNonce, used: protectionNonceUsed}, configurationCancellation: {nonce: q.configurationCancellationNonce, used: configurationCancellationNonceUsed}},
    provedExclusions: excluded, chainAuthenticated: false as const, finalityVerified: false as const, receiptVerified: false as const, fundingReady: false as const,
    productionReady: false as const, currentStateAuthenticated: false as const, signingReady: false as const,
    warning: 'The root may be attacker-chosen or historical. Inclusion does not establish chain identity, block provenance, freshness, finality, deployment history, complete signer-map or pending-action enumeration, or permission to sign/fund.'};
}
