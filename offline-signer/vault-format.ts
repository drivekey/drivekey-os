// Public encrypted-vault shape only. No key generation, unlocking or signing.
import {z} from "zod";
import {getAddress} from "ethers";
import {metadataSchema} from "../core/protocol";
const hex = (length: number) => z.string().regex(new RegExp(`^[0-9a-fA-F]{${length}}$`));
const keystoreSchema = z.object({
  address: hex(40), id: z.string().uuid(), version: z.literal(3),
  Crypto: z.object({
    cipher: z.literal("aes-128-ctr"), cipherparams: z.object({ iv: hex(32) }).strict(), ciphertext: hex(64),
    kdf: z.literal("scrypt"), kdfparams: z.object({ dklen: z.literal(32), n: z.literal(131072), r: z.literal(8), p: z.literal(1), salt: hex(64) }).strict(), mac: hex(64),
  }).strict(),
}).strict();
export const vaultSchema = z.object({ version: z.literal(2), kind: z.literal("drivekey-offline-vault"), public: metadataSchema, keystore: keystoreSchema }).strict();
export type OfflineVault = z.infer<typeof vaultSchema>;

export function validateVault(input: unknown): OfflineVault {
  // Fixed supported KDF parameters prevent malicious vault files requesting arbitrary CPU/RAM.
  const v = vaultSchema.parse(input);
  if (getAddress(`0x${v.keystore.address}`) !== getAddress(v.public.address)) throw new Error("Vault address metadata is inconsistent.");
  return v;
}

