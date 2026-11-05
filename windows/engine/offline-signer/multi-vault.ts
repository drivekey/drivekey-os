// OFFLINE PROCESS ONLY. Never import from a website, backend or companion.
import { randomBytes, randomUUID, scrypt, createCipheriv, createDecipheriv } from "node:crypto";
import { Wallet, Transaction, decryptKeystoreJson } from "ethers";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { retainedSolSecret, wipeSolSecret } from './sol-secret';
import { canonicalSolTransaction, multiApproval, multiPublicSchema, validateMultiRequest, verifyMultiResponse, type MultiPublic, type MultiResponse } from "../core/multi-protocol";
import { checkPassword, validateVault } from "./vault";

import {multiVaultSchema,type MultiVault} from './multi-vault-format';
export {multiVaultSchema,type MultiVault} from './multi-vault-format';
function derive(password: string, salt: Buffer): Promise<Buffer> {
  checkPassword(password);
  return new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
function aad(w: MultiPublic): Buffer { return Buffer.from(JSON.stringify(["DriveKey multi vault v3", w.deviceId, w.createdAt, w.evmAddress, w.solanaAddress])); }
async function encrypt(evmKey: Uint8Array, solSeed: Uint8Array, password: string, context: { deviceId: string; createdAt: string }): Promise<MultiVault> {
  let key: Buffer | undefined, plain: Buffer | undefined, evmBytes: Buffer | undefined, sol: Keypair | undefined;
  try {
    evmBytes = Buffer.from(evmKey);
    const evm = new Wallet("0x" + evmBytes.toString("hex"));
    sol = Keypair.fromSeed(solSeed);
    const publicData: MultiPublic = { version: 3, ...context, evmAddress: evm.address, solanaAddress: sol.publicKey.toBase58() };
    const salt = randomBytes(32), iv = randomBytes(12);
    key = await derive(password, salt); plain = Buffer.concat([evmKey, solSeed]);
    const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(aad(publicData));
    return multiVaultSchema.parse({ version: 3, kind: "drivekey-multi-vault", public: publicData, kdf: "scrypt-131072-8-1", salt: salt.toString("hex"), iv: iv.toString("hex"), ciphertext: Buffer.concat([cipher.update(plain), cipher.final()]).toString("hex"), tag: cipher.getAuthTag().toString("hex") });
  } finally { evmBytes?.fill(0); plain?.fill(0); key?.fill(0); if(sol)wipeSolSecret(sol); }
}
export async function createMultiVault(password: string): Promise<MultiVault> {
  const evm = Wallet.createRandom(), seed = randomBytes(32), evmBytes = Buffer.from(evm.privateKey.slice(2), "hex");
  try { return await encrypt(evmBytes, seed, password, { deviceId: randomUUID(), createdAt: new Date().toISOString() }); }
  finally { seed.fill(0); evmBytes.fill(0); }
}
/** Local provisioning only. The imported EVM key is never reused as a Solana seed. */
export async function importEvmBytes(evmBytes: Uint8Array, password: string, expectedAddress: string): Promise<MultiVault> {
  if (!(evmBytes instanceof Uint8Array) || evmBytes.length !== 32) throw Error('Invalid Ethereum credential.');
  const key = Buffer.from(evmBytes), seed = randomBytes(32);
  try {
    const {getAddress}=await import('ethers');
    const actual=new Wallet('0x'+key.toString('hex')).address;
    if(getAddress(expectedAddress)!==actual)throw Error('The credential does not match the expected public address.');
    return await encrypt(key,seed,password,{deviceId:randomUUID(),createdAt:new Date().toISOString()});
  } catch { throw Error('Local credential import rejected. Check its public address and format.'); }
  finally {key.fill(0);seed.fill(0);}
}
/** Caller must write to NEW files, verify a separate backup and retain the original v2. */
export async function upgradeMultiVault(input: unknown, password: string, consent: boolean): Promise<MultiVault> {
  if (consent !== true) throw new Error("Explicit offline upgrade consent required.");
  const old = validateVault(input), account = await decryptKeystoreJson(JSON.stringify(old.keystore), password), seed = randomBytes(32), evmBytes = Buffer.from(account.privateKey.slice(2), "hex");
  try {
    if (new Wallet(account.privateKey).address.toLowerCase() !== old.public.address.toLowerCase()) throw new Error("Original address mismatch.");
    return await encrypt(evmBytes, seed, password, { deviceId: old.public.deviceId, createdAt: old.public.createdAt });
  }
  finally { seed.fill(0); evmBytes.fill(0); }
}
export async function unlockMultiVault(input: unknown, password: string): Promise<{ evm: Wallet; sol: Keypair }> {
  const v = multiVaultSchema.parse(input), key = await derive(password, Buffer.from(v.salt, "hex"));
  let plain: Buffer | undefined, provisional: Buffer | undefined, final: Buffer | undefined, sol: Keypair | undefined, returned = false;
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "hex")); cipher.setAAD(aad(v.public)); cipher.setAuthTag(Buffer.from(v.tag, "hex"));
    // GCM update releases unauthenticated plaintext. Retain it so final() failure
    // cannot bypass zeroization; also clear the intermediate copies on success.
    provisional = cipher.update(Buffer.from(v.ciphertext, "hex"));
    final = cipher.final();
    plain = Buffer.concat([provisional, final]);
    const evm = new Wallet("0x" + plain.subarray(0, 32).toString("hex")); sol = Keypair.fromSeed(plain.subarray(32));
    if (evm.address !== v.public.evmAddress || sol.publicKey.toBase58() !== v.public.solanaAddress) throw new Error("Address mismatch.");
    returned = true; return { evm, sol };
  } catch { throw new Error("Incorrect passphrase or damaged encrypted vault."); }
  finally { key.fill(0); provisional?.fill(0); final?.fill(0); plain?.fill(0); if(sol && !returned)wipeSolSecret(sol); }
}
export async function signMultiVault(input: unknown, password: string, request: unknown, now = Date.now()): Promise<MultiResponse> {
  const v = multiVaultSchema.parse(input), r = validateMultiRequest(request, now);
  if (r.deviceId !== v.public.deviceId || (r.network === "robinhood" ? r.from.toLowerCase() !== v.public.evmAddress.toLowerCase() : r.from !== v.public.solanaAddress)) throw new Error("Request belongs to a different vault.");
  const keys = await unlockMultiVault(v, password);
  try {
    let rawSignedTransaction: string, approvalSignature: string, transactionHash: string;
    if (r.network === "robinhood") {
      rawSignedTransaction = await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));
      transactionHash = Transaction.from(rawSignedTransaction).hash!;
      approvalSignature = await keys.evm.signMessage(multiApproval(r));
    } else {
      const tx = canonicalSolTransaction(r); tx.sign(keys.sol);
      rawSignedTransaction = tx.serialize().toString("base64"); transactionHash = bs58.encode(tx.signature!);
      approvalSignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(multiApproval(r)), retainedSolSecret(keys.sol)));
    }
    return verifyMultiResponse({ version: r.version, requestId: r.requestId, deviceId: r.deviceId, fingerprint: r.fingerprint, signedAt: new Date(now).toISOString(), rawSignedTransaction, approvalSignature, transactionHash }, r, v.public, now);
  } finally { wipeSolSecret(keys.sol); }
  // JavaScript strings and runtime copies are not guaranteed zeroized. Exit the process after use.
}
