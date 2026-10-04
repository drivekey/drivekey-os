// Node-only module. Never import into the website or Windows companion.
import { randomUUID } from "node:crypto";
import { Wallet, decryptKeystoreJson, encryptKeystoreJson, getAddress, Transaction } from "ethers";
import { z } from "zod";
import { CHAIN_ID, approvalMessage, metadataSchema, validateRequest, verifyResponse, type SignedResponseV2 } from "../core/protocol";

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

export function checkPassword(password: string): void {
  if (password.length < 16 || password.length > 256) throw new Error("Use a unique passphrase of 16–256 characters. Prefer several random words.");
}

export async function createOfflineVault(password: string): Promise<OfflineVault> {
  checkPassword(password);
  const wallet = Wallet.createRandom();
  const encrypted = JSON.parse(await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, password, { scrypt: { N: 131072, r: 8, p: 1 } }));
  return vaultSchema.parse({ version: 2, kind: "drivekey-offline-vault", public: { version: 2, chainId: CHAIN_ID, address: wallet.address, deviceId: randomUUID(), createdAt: new Date().toISOString() }, keystore: encrypted });
}

export function validateVault(input: unknown): OfflineVault {
  // Fixed supported KDF parameters prevent malicious vault files requesting arbitrary CPU/RAM.
  const v = vaultSchema.parse(input);
  if (getAddress(`0x${v.keystore.address}`) !== getAddress(v.public.address)) throw new Error("Vault address metadata is inconsistent.");
  return v;
}

export async function checkOfflineVaultPassword(input: unknown, password: string): Promise<string> {
  const v = validateVault(input);
  let account;
  try { account = await decryptKeystoreJson(JSON.stringify(v.keystore), password); } catch { throw new Error("Incorrect passphrase or damaged encrypted vault. Nothing was signed."); }
  const address = new Wallet(account.privateKey).address;
  if (getAddress(address) !== getAddress(v.public.address)) throw new Error("Decrypted account mismatch.");
  return address;
}

export async function signOfflineVault(input: unknown, password: string, inputRequest: unknown, now = Date.now()): Promise<SignedResponseV2> {
  const v = validateVault(input), request = validateRequest(inputRequest, now);
  if (getAddress(request.from) !== getAddress(v.public.address) || request.deviceId !== v.public.deviceId) throw new Error("Request belongs to a different vault.");
  let account;
  try { account = await decryptKeystoreJson(JSON.stringify(v.keystore), password); } catch { throw new Error("Incorrect passphrase or damaged encrypted vault. Nothing was signed."); }
  const signer = new Wallet(account.privateKey);
  if (getAddress(signer.address) !== getAddress(v.public.address)) throw new Error("Decrypted account mismatch.");
  const rawSignedTransaction = await signer.signTransaction(Transaction.from(request.unsignedTransaction));
  const response: SignedResponseV2 = { version: 2, requestId: request.requestId, deviceId: request.deviceId, fingerprint: request.fingerprint,
    rawSignedTransaction, approvalSignature: await signer.signMessage(approvalMessage(request)), signer: signer.address,
    transactionHash: Transaction.from(rawSignedTransaction).hash!, signedAt: new Date(now).toISOString() };
  // JS runtime memory cannot be guaranteed zeroized. Process exit is part of the workflow.
  return verifyResponse(response, request, v.public, now);
}
