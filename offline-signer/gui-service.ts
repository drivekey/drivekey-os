// Offline process only. Never import into the dashboard or a server route.
import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { formatEther } from "ethers";
import { FILES, validateRequest } from "../core/protocol";
import { readJsonFile, safeDirectory, writeJsonFile } from "../core/files";
import { checkOfflineVaultPassword, createOfflineVault, signOfflineVault, validateVault } from "./vault";
import { assertOfflineEnvironment } from "./environment";

const secret = z.string().max(256);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("review") }).strict(),
  z.object({ action: z.literal("export-public") }).strict(),
  z.object({ action: z.literal("create"), password: secret, confirmation: secret, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("check"), password: secret }).strict(),
  z.object({ action: z.literal("backup"), password: secret }).strict(),
  z.object({ action: z.literal("check-backup"), password: secret }).strict(),
  z.object({ action: z.literal("restore"), password: secret, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("sign"), password: secret, fingerprint: z.string().regex(/^0x[0-9a-f]{64}$/i), consent: z.literal(true) }).strict(),
]);
const BACKUP = "vault-backup.json";
async function absent(directory: string, name: string) {
  try { await access(join(directory, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("Existing file will not be overwritten. Keep your original vault safe.");
}
export async function guiAction(input: unknown, directory: string) {
  const c = command.parse(input);
  await assertOfflineEnvironment();
  await safeDirectory(directory);
  if (c.action === "status") {
    let wallet = null;
    try { wallet = validateVault(await readJsonFile(directory, FILES.vault)).public; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { wallet, utc: new Date().toISOString(), network: "disabled", message: wallet ? "Vault found. Verify your password or review a request." : "No vault yet. Create one or restore an encrypted backup." };
  }
  if (c.action === "create" || c.action === "restore") {
    await absent(directory, FILES.vault); await absent(directory, FILES.metadata);
    if (c.action === "create" && c.password !== c.confirmation) throw new Error("Passphrases differ. Nothing was created. Try again.");
    const vault = c.action === "create" ? await createOfflineVault(c.password) : validateVault(await readJsonFile(directory, BACKUP));
    if (c.action === "restore") await checkOfflineVaultPassword(vault, c.password);
    await assertOfflineEnvironment();
    await writeJsonFile(directory, FILES.vault, vault);
    await writeJsonFile(directory, FILES.metadata, vault.public);
    return { wallet: vault.public, message: "Vault saved and public metadata exported. Verify your passphrase before shutdown." };
  }
  const vault = validateVault(await readJsonFile(directory, FILES.vault));
  if (c.action === "export-public") {
    await writeJsonFile(directory, FILES.metadata, vault.public, true);
    return { wallet: vault.public, message: "wallet-public.json saved. No private key exported." };
  }
  if (c.action === "check" || c.action === "backup" || c.action === "check-backup") {
    const target = c.action === "check-backup" ? validateVault(await readJsonFile(directory, BACKUP)) : vault;
    const address = await checkOfflineVaultPassword(target, c.password);
    if (address !== vault.public.address || target.public.deviceId !== vault.public.deviceId) throw new Error("Backup belongs to another vault.");
    await assertOfflineEnvironment();
    if (c.action === "backup") await writeJsonFile(directory, BACKUP, vault);
    return { wallet: vault.public, message: c.action === "backup" ? "Encrypted vault-backup.json saved. A copy on this same USB does not protect against losing the USB. Store a separate encrypted backup after shutdown." : "Passphrase and address verified. No transaction signed." };
  }
  const request = validateRequest(await readJsonFile(directory, FILES.request));
  if (request.from.toLowerCase() !== vault.public.address.toLowerCase() || request.deviceId !== vault.public.deviceId) throw new Error("Request belongs to a different vault.");
  if (c.action === "review") {
    return { review: { from: request.from, recipient: request.to, network: "Robinhood Chain / 4663 / native ETH", amount: formatEther(request.value) + " ETH", maximumFee: formatEther(BigInt(request.gasLimit) * BigInt(request.maxFeePerGas)) + " ETH", maximumDebit: formatEther(BigInt(request.value) + BigInt(request.gasLimit) * BigInt(request.maxFeePerGas)) + " ETH", nonce: request.nonce, deadlineUTC: request.expiresAt, requestId: request.requestId, fingerprint: request.fingerprint }, message: "Compare the full recipient against an independently known address. Approval signs this exact transfer." };
  }
  if (request.fingerprint !== c.fingerprint) throw new Error("Request changed since review. Review again; nothing was signed.");
  const response = await signOfflineVault(vault, c.password, request);
  await assertOfflineEnvironment();
  // Do not export an approval that expired during password derivation.
  validateRequest(request);
  const current = validateRequest(await readJsonFile(directory, FILES.request));
  if (current.fingerprint !== request.fingerprint) throw new Error("Request changed during signing. Nothing was exported.");
  await writeJsonFile(directory, FILES.response, response, true);
  return { hash: response.transactionHash, message: "signed-response.json saved and verified. Nothing was broadcast. Shut down fully before returning to Windows." };
}

export function safeGuiError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "Expected file missing. Check the DriveKey folder and exact filenames.";
  if (code === "EROFS" || code === "EACCES") return "Storage is read-only or permission was denied. No success was recorded.";
  if (code === "ENOSPC") return "USB storage is full. Preserve your vault and free space in Windows after shutdown.";
  if (code === "EEXIST") return "Existing file will not be overwritten. Verify your existing backup instead.";
  const message = error instanceof Error ? error.message : "";
  const allowed = ["Passphrases differ.", "Incorrect passphrase or damaged encrypted vault.", "Use a unique passphrase of", "Existing file will not", "Request expired.", "Invalid request lifetime or clock.", "Request changed", "Request belongs", "Backup belongs", "Boot the DriveKey", "Real vault setup", "Network addresses", "An active network", "Swap must"];
  return allowed.some(p => message.startsWith(p)) ? message : "Operation stopped. Check the expected files, clock and drive space. No existing vault was overwritten. You can retry.";
}
