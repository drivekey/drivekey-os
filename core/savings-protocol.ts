import {z} from 'zod';
import {AbiCoder, getAddress, keccak256, TypedDataEncoder, verifyTypedData, ZeroAddress, ZeroHash} from 'ethers';

// Prototype-only protocol. No funded signing/broadcast integration is enabled here.
export const SAVINGS_CHAIN_ID = 1;
export const SAVINGS_USDC = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
export const SAVINGS_SECURITY_DELAY = 3600;
export const SAVINGS_MAX_LIFETIME = 86400;
export const SAVINGS_PRESETS = {
  standard: {value: 0, signers: 1, threshold: 1, withdrawalDelay: 300},
  strong: {value: 1, signers: 3, threshold: 2, withdrawalDelay: 900},
} as const;
export const SAVINGS_KIND = {withdraw: 0, configure: 1, resume: 2} as const;
const address = z.string().refine(v => {try {getAddress(v); return true;} catch {return false;}}, 'Invalid address').transform(getAddress);
const nonzeroAddress = address.refine(v => v !== ZeroAddress, 'Zero address');
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase());
const uint256 = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) < 2n ** 256n, 'Integer overflow');
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const preset = z.union([z.literal(0), z.literal(1)]);
export const savingsConfigSchema = z.object({preset, signers: z.array(nonzeroAddress).min(1).max(3)}).strict().superRefine((c, ctx) => {
  if (c.signers.length !== (c.preset === 0 ? 1 : 3)) ctx.addIssue({code: 'custom', message: 'Invalid signer count'});
  if (c.signers.some((v, i) => i > 0 && BigInt(v) <= BigInt(c.signers[i - 1]))) ctx.addIssue({code: 'custom', message: 'Signer addresses must be distinct and numerically sorted'});
});
export type SavingsConfig = z.infer<typeof savingsConfigSchema>;
export const savingsActionSchema = z.object({
  kind: z.union([z.literal(0), z.literal(1), z.literal(2)]), asset: address, recipient: address,
  amount: uint256, nonce: uint256, expiry: counter, epoch: counter.min(1), currentConfigHash: hash, newConfigHash: hash,
}).strict().superRefine((a, ctx) => {
  if (a.kind === 0) {
    if (![ZeroAddress, SAVINGS_USDC].includes(a.asset) || a.recipient === ZeroAddress || BigInt(a.amount) === 0n || a.newConfigHash !== ZeroHash) ctx.addIssue({code: 'custom', message: 'Invalid withdrawal'});
  } else if (a.asset !== ZeroAddress || a.recipient !== ZeroAddress || a.amount !== '0' || (a.kind === 1 ? a.newConfigHash === ZeroHash : a.newConfigHash !== ZeroHash)) ctx.addIssue({code: 'custom', message: 'Invalid security action'});
});
export type SavingsAction = z.infer<typeof savingsActionSchema>;
export const savingsProtectionSchema = z.object({kind: z.union([z.literal(0), z.literal(1)]), actionId: hash, nonce: uint256, expiry: counter, epoch: counter.min(1), currentConfigHash: hash}).strict().refine(p => p.kind === 0 || p.actionId === ZeroHash, 'Pause cannot target a single action');
export type SavingsProtection = z.infer<typeof savingsProtectionSchema>;
export const SAVINGS_ACTION_TYPES = {Action: [
  {name: 'kind', type: 'uint8'}, {name: 'asset', type: 'address'}, {name: 'recipient', type: 'address'},
  {name: 'amount', type: 'uint256'}, {name: 'nonce', type: 'uint256'}, {name: 'expiry', type: 'uint64'},
  {name: 'epoch', type: 'uint64'}, {name: 'currentConfigHash', type: 'bytes32'}, {name: 'newConfigHash', type: 'bytes32'},
]};
export const SAVINGS_PROTECTION_TYPES = {Protection: [
  {name: 'kind', type: 'uint8'}, {name: 'actionId', type: 'bytes32'}, {name: 'nonce', type: 'uint256'},
  {name: 'expiry', type: 'uint64'}, {name: 'epoch', type: 'uint64'}, {name: 'currentConfigHash', type: 'bytes32'},
]};
export const SAVINGS_ACTION_ABI = 'tuple(uint8 kind,address asset,address recipient,uint256 amount,uint256 nonce,uint64 expiry,uint64 epoch,bytes32 currentConfigHash,bytes32 newConfigHash)';
export const SAVINGS_PROTECTION_ABI = 'tuple(uint8 kind,bytes32 actionId,uint256 nonce,uint64 expiry,uint64 epoch,bytes32 currentConfigHash)';
export const SAVINGS_ABI = [
  `function queue(${SAVINGS_ACTION_ABI} action,bytes[] approvals) returns (bytes32)`,
  `function execute(${SAVINGS_ACTION_ABI} action,uint8 newPreset,address[] newSigners)`,
  'function cancel(bytes32 actionId)', 'function pause()',
  `function protect(${SAVINGS_PROTECTION_ABI} protection,bytes approval)`,
  `function cancelConfiguration(${SAVINGS_PROTECTION_ABI} protection,bytes[] approvals)`,
  'function epoch() view returns (uint64)', 'function paused() view returns (bool)',
  'function currentConfigHash() view returns (bytes32)', 'function signers() view returns (address[])',
  'function preset() view returns (uint8)', 'function threshold() view returns (uint256)',
  'function withdrawalDelay() view returns (uint64)',
  'function usedNonce(uint256) view returns (bool)',
  'function usedProtectionNonce(uint256) view returns (bool)',
  'function usedConfigurationCancellationNonce(uint256) view returns (bool)',
  'function USDC() view returns (address)', 'function CHAIN_ID() view returns (uint256)',
  'function SECURITY_DELAY() view returns (uint64)', 'function MAX_LIFETIME() view returns (uint64)',
  'function pending(bytes32) view returns (uint64 queuedAt,uint64 readyAt,uint64 expiry,uint64 epoch,uint8 status,uint8 kind)',
  'event Deposited(address indexed sender,uint256 amount)',
  'event Queued(bytes32 indexed actionId,uint8 kind,uint256 nonce,uint64 epoch,uint64 readyAt,uint64 expiry)',
  'event Executed(bytes32 indexed actionId,uint8 kind)',
  'event Withdrawn(bytes32 indexed actionId,address indexed asset,address indexed recipient,uint256 amount)',
  'event Cancelled(bytes32 indexed actionId,address indexed signer)',
  'event Paused(address indexed signer,uint64 epoch)',
  'event Resumed(uint64 epoch)',
  'event ConfigurationApplied(bytes32 indexed configurationHash,uint8 preset,uint64 epoch)',
] as const;
export function savingsDomain(vault: string) {
  return {name: 'DriveKey Savings', version: '1', chainId: SAVINGS_CHAIN_ID, verifyingContract: nonzeroAddress.parse(vault)};
}
export function savingsConfigHash(input: unknown) {
  const c = savingsConfigSchema.parse(input);
  return keccak256(AbiCoder.defaultAbiCoder().encode(['uint8', 'address[]'], [c.preset, c.signers]));
}
export function savingsActionHash(vault: string, input: unknown) {
  return TypedDataEncoder.hash(savingsDomain(vault), SAVINGS_ACTION_TYPES, savingsActionSchema.parse(input));
}
export function savingsProtectionHash(vault: string, input: unknown) {
  return TypedDataEncoder.hash(savingsDomain(vault), SAVINGS_PROTECTION_TYPES, savingsProtectionSchema.parse(input));
}
/** Recheck before signing/queueing; this public context is not a receipt or independent chain attestation. */
export function validateSavingsAction(vault: string, input: unknown, configuration: unknown, epoch: number, paused: boolean, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(epoch) || epoch < 1 || typeof paused !== 'boolean') throw Error('Invalid savings context or clock');
  const a = savingsActionSchema.parse(input), c = savingsConfigSchema.parse(configuration);
  const current = Math.floor(now / 1000), delay = a.kind === 0 ? (c.preset === 0 ? 300 : 900) : SAVINGS_SECURITY_DELAY;
  if (a.currentConfigHash !== savingsConfigHash(c) || a.epoch !== epoch || a.recipient === nonzeroAddress.parse(vault)) throw Error('Stale or invalid savings context');
  if (a.expiry <= current + delay || a.expiry > current + SAVINGS_MAX_LIFETIME) throw Error('Expiry leaves insufficient delay or exceeds 24 hours');
  if ((a.kind === 0 && paused) || (a.kind === 2 && !paused)) throw Error('Action is unavailable in the current paused state');
  return a;
}
/** Returns sorted signer addresses only; never implies on-chain queueing or execution. */
export function verifySavingsApprovals(vault: string, input: unknown, configuration: unknown, signatures: string[]) {
  const a = savingsActionSchema.parse(input), c = savingsConfigSchema.parse(configuration);
  if (a.currentConfigHash !== savingsConfigHash(c) || signatures.length !== (c.preset === 0 ? 1 : 2)) throw Error('Savings quorum mismatch');
  if (signatures.some(signature => !/^0x[0-9a-f]{128}(1b|1c)$/i.test(signature))) throw Error('Expected canonical 65-byte savings signature');
  const signers = signatures.map(signature => getAddress(verifyTypedData(savingsDomain(vault), SAVINGS_ACTION_TYPES, a, signature)));
  if (signers.some((s, i) => !c.signers.includes(s) || (i > 0 && BigInt(s) <= BigInt(signers[i - 1])))) throw Error('Unregistered, duplicate or unsorted signer');
  return signers;
}
