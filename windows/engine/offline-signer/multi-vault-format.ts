// Encrypted/public format only. No key generation, decryption or signing imports.
import {z} from 'zod';
import {multiPublicSchema} from '../core/multi-protocol';
const hex = (n:number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`));
export const multiVaultSchema = z.object({version:z.literal(3),kind:z.literal('drivekey-multi-vault'),
 public:multiPublicSchema,kdf:z.literal('scrypt-131072-8-1'),salt:hex(64),iv:hex(24),ciphertext:hex(128),tag:hex(32)}).strict();
export type MultiVault = z.infer<typeof multiVaultSchema>;
