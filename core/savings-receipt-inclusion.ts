// Public research only: exact paired leaves under supplied, unanchored roots.
import {z} from 'zod';
import {getAddress, getBytes, hexlify, Interface, keccak256, toBeHex} from 'ethers';
import {createMPTFromProof, createMerkleProof, RLP} from '../scripts/savings-inclusion-research/library';
import {inspectSavingsCall, savingsCallExpectationSchema} from './savings-lifecycle';
import {SAVINGS_ABI, SAVINGS_USDC} from './savings-protocol';
import {parseStrictPublicJson} from './strict-public-json';
import {savingsBuildArtifactSchema, savingsEnrollmentIntentSchema, savingsDeploymentProposalSchema, savingsSignedDeploymentSchema,
  verifySavingsSignedDeployment} from './savings-enrollment';

export const SAVINGS_RECEIPT_LIMITS = Object.freeze({fileBytes: 1048576, transactionBytes: 8192, deploymentTransactionBytes: 52000, receiptBytes: 16384,
  nodesPerProof: 64, nodeBytes: 65536, logs: 16, topicsPerLog: 4, logDataBytes: 512});
export const SAVINGS_RECEIPT_WARNING = 'Exact transaction and receipt leaves match supplied roots at one index. Their roots and timestamp are not bound to a block header or authenticated chain. No runtime-code/state proof, current balance, execution eligibility, freshness, finality, or signing/funding authority is established.';
const hash = z.string().regex(/^0x[0-9a-f]{64}$/), counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const bytes = (max: number) => z.string().max(2 + max * 2).regex(/^0x(?:[0-9a-f]{2})+$/);
const proofNodes = z.array(bytes(SAVINGS_RECEIPT_LIMITS.nodeBytes)).min(1).max(SAVINGS_RECEIPT_LIMITS.nodesPerProof);
export const savingsReceiptRootContextSchema = z.object({kind: z.literal('drivekey-savings-supplied-root-pair'), version: z.literal(1),
  transactionRoot: hash, receiptRoot: hash, blockTimestamp: counter}).strict();
export const savingsReceiptInclusionProofSchema = z.object({kind: z.literal('drivekey-savings-paired-inclusion'), version: z.literal(1),
  transactionIndex: counter, transactionProof: proofNodes, receiptProof: proofNodes, rawReceipt: bytes(SAVINGS_RECEIPT_LIMITS.receiptBytes)}).strict();
export type SavingsReceiptRootContext = z.infer<typeof savingsReceiptRootContextSchema>;
export type SavingsReceiptInclusionProof = z.infer<typeof savingsReceiptInclusionProofSchema>;
export const savingsDeploymentReceiptExpectationSchema = z.object({kind: z.literal('drivekey-savings-deployment-receipt-expectation'), version: z.literal(1),
  artifact: savingsBuildArtifactSchema, intent: savingsEnrollmentIntentSchema, proposal: savingsDeploymentProposalSchema, signed: savingsSignedDeploymentSchema}).strict();
export type SavingsDeploymentReceiptExpectation = z.infer<typeof savingsDeploymentReceiptExpectationSchema>;
export const savingsReceiptExpectationSchema = z.union([savingsCallExpectationSchema, savingsDeploymentReceiptExpectationSchema]);
export function parseSavingsReceiptInclusionFile(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.length > SAVINGS_RECEIPT_LIMITS.fileBytes) throw Error('Receipt inclusion file exceeds bound.');
  const value = parseStrictPublicJson(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(input), SAVINGS_RECEIPT_LIMITS.fileBytes);
  return z.union([savingsReceiptRootContextSchema, savingsReceiptInclusionProofSchema, savingsReceiptExpectationSchema]).parse(value);
}
type Rlp = Uint8Array | Rlp[];
function canonicalRlp(input: Uint8Array): Rlp {
  const value = RLP.decode(input) as Rlp; if (hexlify(RLP.encode(value)) !== hexlify(input)) throw Error('Noncanonical RLP.'); return value;
}
function scalar(value: Rlp, max: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length > max || (value.length > 0 && value[0] === 0)) throw Error('Noncanonical scalar.'); return value;
}
function integer(value: Uint8Array) {return value.length ? BigInt(hexlify(value)) : 0n;}
/** Ethereum transaction/receipt trie keys are ordinary RLP(index), NOT secure hashes. */
export function savingsReceiptIndexKey(input: unknown) {
  const index = counter.parse(input); return RLP.encode(index === 0 ? new Uint8Array() : getBytes(toBeHex(index)));
}
function nodeShape(node: Rlp, nesting = 0): void {
  if (nesting > 32 || !Array.isArray(node) || ![2, 17].includes(node.length)) throw Error('Invalid indexed trie node.');
  const reference = (child: Rlp, empty: boolean) => {
    if (Array.isArray(child)) {if (RLP.encode(child).length >= 32) throw Error('Oversized embedded node.'); nodeShape(child, nesting + 1);}
    else if (child.length !== 32 && !(empty && child.length === 0)) throw Error('Invalid child reference.');
  };
  if (node.length === 17) {
    node.slice(0, 16).forEach(child => reference(child, true));
    // Canonical RLP integer keys are prefix-free; no indexed branch value.
    if (!(node[16] instanceof Uint8Array) || node[16].length || node.slice(0, 16).filter(c => Array.isArray(c) || c.length).length < 2) throw Error('Noncanonical indexed branch.');
  } else {
    const path = node[0]; if (!(path instanceof Uint8Array) || path.length < 1 || path.length > 9) throw Error('Unsupported indexed compact path.');
    const flag = path[0] >> 4, width = path.length * 2 - (flag & 1 ? 1 : 2);
    if (flag > 3 || (!(flag & 1) && (path[0] & 15)) || width > 16 || (flag < 2 && width === 0)) throw Error('Noncanonical indexed compact path.');
    if (flag < 2) reference(node[1], false); else if (!(node[1] instanceof Uint8Array) || !node[1].length) throw Error('Empty indexed leaf.');
  }
}
/** Strict membership only. No root, block or chain authentication is implied. */
export async function verifySavingsIndexedTrieLeaf(rootInput: unknown, indexInput: unknown, proofInput: unknown) {
  const root = hash.parse(rootInput), key = savingsReceiptIndexKey(indexInput), nodes = proofNodes.parse(proofInput);
  if (nodes.reduce((sum, n) => sum + (n.length - 2) / 2, 0) > SAVINGS_RECEIPT_LIMITS.fileBytes) throw Error('Indexed proof work exceeds bound.');
  if (new Set(nodes).size !== nodes.length) throw Error('Duplicate indexed proof node.');
  const proof = nodes.map(n => {const b = getBytes(n); nodeShape(canonicalRlp(b)); return b;});
  const trie = await createMPTFromProof(proof, {root: getBytes(root), useKeyHashing: false});
  if (hexlify(trie.root()) !== root) throw Error('Indexed proof root substitution.');
  const value = await trie.get(key, true); if (value === null) throw Error('Expected transaction or receipt is absent.');
  const path = await createMerkleProof(trie, key); let width = 0;
  for (const [i, encoded] of path.entries()) {
    const node = canonicalRlp(encoded) as Rlp[];
    if (node.length === 17) width++;
    else {const compact = node[0] as Uint8Array, flag = compact[0] >> 4;
      width += compact.length * 2 - (flag & 1 ? 1 : 2);
      if (flag >= 2 && width !== key.length * 2) throw Error('Indexed leaf path has the wrong width.');
      if (flag < 2 && i < path.length - 1 && (canonicalRlp(path[i + 1]) as Rlp[]).length !== 17) throw Error('Uncompressed indexed extension.');}
    if (width > key.length * 2) throw Error('Indexed path exceeds key width.');
  }
  const minimal = path.filter((n, i) => i === 0 || n.length >= 32).map(hexlify);
  if (JSON.stringify(minimal) !== JSON.stringify(nodes)) throw Error('Extra, unused, missing or reordered indexed proof node.');
  return value;
}
type ReceiptLog = {address: string; topics: string[]; data: string; transactionLocalIndex: number};
function bloomFor(logs: ReceiptLog[]) {
  const bloom = new Uint8Array(256);
  for (const log of logs) for (const item of [log.address, ...log.topics]) {
    const digest = getBytes(keccak256(item));
    for (let i = 0; i < 6; i += 2) {const bit = ((digest[i] << 8) | digest[i + 1]) & 2047; bloom[255 - (bit >> 3)] |= 1 << (bit & 7);}
  }
  return hexlify(bloom);
}
export function decodeSavingsTypedReceipt(input: unknown) {
  const raw = bytes(SAVINGS_RECEIPT_LIMITS.receiptBytes).parse(input), payload = getBytes(raw);
  if (payload[0] !== 2) throw Error('Only type-2 receipts matching the supported transaction type are accepted.');
  const decoded = canonicalRlp(payload.subarray(1)); if (!Array.isArray(decoded) || decoded.length !== 4) throw Error('Invalid receipt tuple.');
  const status = integer(scalar(decoded[0], 1)); if (status > 1n) throw Error('Invalid receipt status.');
  const cumulativeGasUsed = integer(scalar(decoded[1], 8)); if (cumulativeGasUsed === 0n) throw Error('Receipt cumulative gas cannot be zero.');
  if (!(decoded[2] instanceof Uint8Array) || decoded[2].length !== 256 || !Array.isArray(decoded[3]) || decoded[3].length > SAVINGS_RECEIPT_LIMITS.logs) throw Error('Invalid receipt bloom/logs.');
  const logs: ReceiptLog[] = decoded[3].map((log, i) => {
    if (!Array.isArray(log) || log.length !== 3 || !(log[0] instanceof Uint8Array) || log[0].length !== 20 || !Array.isArray(log[1]) ||
      log[1].length > SAVINGS_RECEIPT_LIMITS.topicsPerLog || log[1].some(topic => !(topic instanceof Uint8Array) || topic.length !== 32) ||
      !(log[2] instanceof Uint8Array) || log[2].length > SAVINGS_RECEIPT_LIMITS.logDataBytes) throw Error('Invalid receipt log.');
    return {address: getAddress(hexlify(log[0])), topics: log[1].map(t => hexlify(t as Uint8Array)), data: hexlify(log[2]), transactionLocalIndex: i};
  });
  const bloom = hexlify(decoded[2]); if (bloomFor(logs) !== bloom) throw Error('Receipt bloom differs from its exact logs.');
  if (status === 0n && logs.length) throw Error('Reverted transaction cannot publish effect logs.');
  return {type: 2 as const, status: Number(status) as 0 | 1, cumulativeGasUsed: cumulativeGasUsed.toString(), bloom, logs};
}
const contract = new Interface(SAVINGS_ABI), token = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
function matchEffects(call: ReturnType<typeof inspectSavingsCall>, receipt: ReturnType<typeof decodeSavingsTypedReceipt>, timestamp: number) {
  const e = call.expected, o = e.operation, a = call.action;
  const wanted: {name: string; values: unknown[]}[] = [];
  if (o.kind === 'queue') {
    const delay = a!.kind === 0 ? e.configuration.preset === 0 ? 300 : 900 : 3600;
    if (!Number.isSafeInteger(timestamp + 86400) || a!.expiry <= timestamp + delay || a!.expiry > timestamp + 86400 ||
      (a!.kind === 0 && e.paused) || (a!.kind === 2 && !e.paused)) throw Error('Queue effect contradicts supplied time/policy.');
    wanted.push({name: 'Queued', values: [call.actionId, a!.kind, a!.nonce, a!.epoch, timestamp + delay, a!.expiry]});
  } else if (o.kind === 'execute') {
    if (timestamp >= a!.expiry || (a!.kind === 0 && e.paused) || (a!.kind === 2 && !e.paused)) throw Error('Execution effect contradicts supplied time/policy.');
    wanted.push(a!.kind === 0 ? {name: 'Withdrawn', values: [call.actionId, a!.asset, a!.recipient, a!.amount]} : a!.kind === 1 ?
      {name: 'ConfigurationApplied', values: [a!.newConfigHash, o.newConfiguration!.preset, e.epoch + 1]} : {name: 'Resumed', values: [e.epoch + 1]},
      {name: 'Executed', values: [call.actionId, a!.kind]});
  } else {
    if ((o.kind === 'protect' || o.kind === 'cancel-configuration') && (o.protection.expiry <= timestamp || o.protection.expiry > timestamp + 86400)) throw Error('Protection effect contradicts supplied time.');
    if (o.kind === 'pause' || (o.kind === 'protect' && o.protection.kind === 1)) {
      if (e.paused) throw Error('Repeated pause cannot succeed.'); wanted.push({name: 'Paused', values: [call.protectiveSigner, e.epoch + 1]});
    } else wanted.push({name: 'Cancelled', values: [call.actionId, call.protectiveSigner]});
  }
  const own = receipt.logs.filter(log => log.address === e.vault);
  if (own.length !== wanted.length) throw Error('Missing or extra savings effect logs.');
  wanted.forEach((w, i) => {const encoded = contract.encodeEventLog(contract.getEvent(w.name)!, w.values);
    if (own[i].data !== encoded.data || JSON.stringify(own[i].topics) !== JSON.stringify(encoded.topics)) throw Error('Savings log differs from exact call.');});
  if (o.kind === 'execute' && a?.kind === 0 && a.asset === SAVINGS_USDC) {
    const encoded = token.encodeEventLog(token.getEvent('Transfer')!, [e.vault, a.recipient, a.amount]);
    const transfers = receipt.logs.filter(log => log.address === SAVINGS_USDC && log.topics[0] === encoded.topics[0]);
    if (transfers.length !== 1 || transfers[0].transactionLocalIndex >= own[0].transactionLocalIndex || transfers[0].data !== encoded.data ||
      JSON.stringify(transfers[0].topics) !== JSON.stringify(encoded.topics)) throw Error('Canonical USDC transfer differs or is absent.');
  }
  return wanted.map(w => w.name);
}
export async function verifySavingsReceiptInclusion(rootContextInput: unknown, expectedInput: unknown, proofInput: unknown) {
  const rootContext = savingsReceiptRootContextSchema.parse(rootContextInput), expected = savingsReceiptExpectationSchema.parse(expectedInput), proof = savingsReceiptInclusionProofSchema.parse(proofInput);
  const call = expected.kind === 'drivekey-savings-call-expectation' ? inspectSavingsCall(expected) : null;
  const deployment = expected.kind === 'drivekey-savings-deployment-receipt-expectation' ?
    verifySavingsSignedDeployment(expected.artifact, expected.intent, expected.proposal, expected.signed) : null;
  const rawTransaction = expected.kind === 'drivekey-savings-call-expectation' ? expected.rawTransaction : expected.signed.rawTransaction;
  const extraBuildBytes = expected.kind === 'drivekey-savings-deployment-receipt-expectation' ?
    [expected.artifact.creationCode, expected.artifact.runtimeCode, expected.proposal.unsignedTransaction] : [];
  const work = [rawTransaction, proof.rawReceipt, ...proof.transactionProof, ...proof.receiptProof, ...extraBuildBytes].reduce((sum, b) => sum + (b.length - 2) / 2, 0);
  if (work > SAVINGS_RECEIPT_LIMITS.fileBytes) throw Error('Paired inclusion work exceeds bound.');
  const transaction = await verifySavingsIndexedTrieLeaf(rootContext.transactionRoot, proof.transactionIndex, proof.transactionProof);
  if (hexlify(transaction) !== rawTransaction) throw Error('Proved transaction differs from exact signed call/deployment.');
  const leaf = await verifySavingsIndexedTrieLeaf(rootContext.receiptRoot, proof.transactionIndex, proof.receiptProof);
  if (hexlify(leaf) !== proof.rawReceipt) throw Error('Proved receipt differs from supplied bytes.');
  const receipt = decodeSavingsTypedReceipt(proof.rawReceipt), effects = receipt.status === 1 && call ? matchEffects(call, receipt, rootContext.blockTimestamp) : [];
  if (deployment && receipt.logs.length) throw Error('Pinned savings constructor cannot emit logs.');
  return {status: receipt.status === 1 ? 'matched-success-under-supplied-roots' as const : 'matched-revert-under-supplied-roots' as const,
    provenance: 'supplied-execution-root-pair-not-authenticated' as const, suppliedRoots: rootContext,
    transactionIndex: proof.transactionIndex, transactionHash: call?.transactionHash ?? deployment!.transactionHash,
    caller: call?.caller ?? deployment!.deployer, vault: call?.expected.vault ?? deployment!.expectedVault, actionId: call?.actionId ?? null,
    operation: call?.expected.operation.kind ?? 'deploy', receipt, matchedEffects: effects,
    deployment: deployment ? {derivedVault: deployment.expectedVault, deployer: deployment.deployer, nonce: deployment.nonce,
      configuration: deployment.configuration, configurationHash: deployment.configurationHash, runtimeCodeHash: deployment.runtimeCodeHash,
      initCodeHash: deployment.initCodeHash, outcome: receipt.status === 1 ? 'creation-succeeded-under-supplied-roots' as const : 'creation-reverted-under-supplied-roots' as const} : null,
    chainAuthenticated: false as const, receiptVerified: false as const, deploymentReady: false as const,
    finalityVerified: false as const, fundingReady: false as const, productionReady: false as const, signingReady: false as const,
    currentStateAuthenticated: false as const, rootPairBoundToHeader: false as const, runtimeCodeVerified: false as const,
    warning: SAVINGS_RECEIPT_WARNING};
}
