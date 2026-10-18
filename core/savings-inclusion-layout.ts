import {keccak256, toUtf8Bytes} from 'ethers';
import {z} from 'zod';

// Normalized compiler 0.8.30 storageLayout for the separately pinned V1 code.
// AST identifiers are intentionally excluded; type/encoding/slot/offset/width are not.
function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
export const SAVINGS_INCLUSION_LAYOUT = deepFreeze({
  storage: [
    ['preset', '0', 0, 'enum DriveKeySavingsV1.Preset', 'inplace', '1'],
    ['epoch', '0', 1, 'uint64', 'inplace', '8'], ['paused', '0', 9, 'bool', 'inplace', '1'],
    ['currentConfigHash', '1', 0, 'bytes32', 'inplace', '32'], ['signerList', '2', 0, 'address[]', 'dynamic_array', '32'],
    ['isSigner', '3', 0, 'mapping(address => bool)', 'mapping', '32'],
    ['usedNonce', '4', 0, 'mapping(uint256 => bool)', 'mapping', '32'],
    ['usedProtectionNonce', '5', 0, 'mapping(uint256 => bool)', 'mapping', '32'],
    ['usedConfigurationCancellationNonce', '6', 0, 'mapping(uint256 => bool)', 'mapping', '32'],
    ['pending', '7', 0, 'mapping(bytes32 => struct DriveKeySavingsV1.Pending)', 'mapping', '32'],
    ['entered', '8', 0, 'bool', 'inplace', '1'],
  ],
  pending: [['queuedAt', '0', 0, 'uint64', '8'], ['readyAt', '0', 8, 'uint64', '8'], ['expiry', '0', 16, 'uint64', '8'],
    ['epoch', '0', 24, 'uint64', '8'], ['status', '1', 0, 'enum DriveKeySavingsV1.Status', '1'], ['kind', '1', 1, 'enum DriveKeySavingsV1.Kind', '1']],
  referencedTypes: [['signerList', 'address', '20'], ['isSigner', 'address', 'bool'], ['usedNonce', 'uint256', 'bool'],
    ['usedProtectionNonce', 'uint256', 'bool'], ['usedConfigurationCancellationNonce', 'uint256', 'bool'], ['pending', 'bytes32', 'struct DriveKeySavingsV1.Pending']],
});
export const SAVINGS_INCLUSION_LAYOUT_HASH = keccak256(toUtf8Bytes(JSON.stringify(SAVINGS_INCLUSION_LAYOUT)));
const field = z.object({astId: z.number().int(), contract: z.literal('contracts/DriveKeySavingsV1.sol:DriveKeySavingsV1'), label: z.string().max(80),
  offset: z.number().int().min(0).max(31), slot: z.string().regex(/^\d+$/).max(78), type: z.string().max(100)}).strict();
const type = z.object({encoding: z.enum(['inplace', 'mapping', 'dynamic_array']), label: z.string().max(100), numberOfBytes: z.string().regex(/^\d+$/),
  key: z.string().optional(), value: z.string().optional(), base: z.string().optional(), members: z.array(field).max(6).optional()}).strict();
export function assertSavingsInclusionStorageLayout(input: unknown) {
  const layout = z.object({storage: z.array(field).length(11), types: z.record(type)}).strict().parse(input);
  const storage = layout.storage.map(f => {const t = layout.types[f.type]; if (!t) throw Error('Missing layout type.'); return [f.label, f.slot, f.offset, t.label, t.encoding, t.numberOfBytes];});
  const pendingMap = layout.types[layout.storage.find(f => f.label === 'pending')!.type], pendingType = layout.types[pendingMap.value!];
  if (!pendingType || pendingType.numberOfBytes !== '64' || !pendingType.members) throw Error('Invalid pending struct.');
  const pending = pendingType.members.map(f => {const t = layout.types[f.type]; return [f.label, f.slot, f.offset, t.label, t.numberOfBytes];});
  const referencedTypes = layout.storage.filter(f => ['signerList','isSigner','usedNonce','usedProtectionNonce','usedConfigurationCancellationNonce','pending'].includes(f.label)).map(f => {
    const t = layout.types[f.type]; return t.base ? [f.label, layout.types[t.base].label, layout.types[t.base].numberOfBytes] : [f.label, layout.types[t.key!].label, layout.types[t.value!].label];
  });
  if (JSON.stringify({storage, pending, referencedTypes}) !== JSON.stringify(SAVINGS_INCLUSION_LAYOUT)) throw Error('Savings compiler storage layout differs from the reviewed manifest.');
  return {layoutHash: SAVINGS_INCLUSION_LAYOUT_HASH, layout: SAVINGS_INCLUSION_LAYOUT};
}
