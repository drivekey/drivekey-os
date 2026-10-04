import { mkdir, access } from "node:fs/promises";
import { assertOfflineEnvironment } from "./environment";
export { assertOfflineEnvironment } from "./environment";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { formatEther } from "ethers";
import { FILES, validateRequest } from "../core/protocol";
import { readJsonFile, safeDirectory, writeJsonFile } from "../core/files";
import { createOfflineVault, signOfflineVault, validateVault, checkOfflineVaultPassword } from "./vault";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

export async function hidden(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) throw new Error("Passphrases require an interactive terminal; piping secrets is not supported.");
  process.stdout.write(question);
  input.setEncoding("utf8"); input.setRawMode(true); input.resume();
  return new Promise((resolveValue, reject) => {
    let value = "", done = false;
    const finish = (error?: Error) => {
      if (done) return; done = true; input.off("data", receive); input.setRawMode(false); input.pause(); process.stdout.write("\n");
      if (error) reject(error); else resolveValue(value);
    };
    const receive = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") return finish(new Error("Cancelled."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\b" || char === "\u007f") value = value.slice(0, -1);
        else if (char >= " " && value.length < 256) value += char;
      }
    };
    input.on("data", receive);
  });
}

async function main() {
  const [command, location] = process.argv.slice(2);
  if (!location || !["create", "sign", "export-public", "check-vault"].includes(command)) {
    console.log("DriveKey offline signer v2\nUsage: drivekey-signer <create|sign|export-public|check-vault> <exchange-directory>\nNever run this on your normal online OS. No command broadcasts transactions."); return;
  }
  await assertOfflineEnvironment();
  console.log("\nDRIVEKEY / OFFLINE SESSION / ROBINHOOD MAINNET 4663\nTrusted-clean-PC prototype. Boot media/firmware integrity is not guaranteed.\n");
  const directory = resolve(location);
  if (command === "create") {
    await mkdir(directory, { recursive: true }); await safeDirectory(directory);
    for (const file of [FILES.vault, FILES.metadata]) {
      try { await access(join(directory, file)); throw new Error("Vault or public metadata already exists. Existing files will not be overwritten."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    console.log("Create a NEW vault. Loss of the only encrypted copy or its passphrase means loss of access.\nSave an encrypted backup later. Do not use a password from a chat.");
    if (await ask("Type CREATE to continue: ") !== "CREATE") throw new Error("Cancelled.");
    let password = await hidden("New unique passphrase (16+ characters, hidden): ");
    let confirm = await hidden("Repeat passphrase (hidden): ");
    if (password !== confirm) throw new Error("Passphrases differ. No vault was created. Run create again.");
    console.log("Encrypting locally…");
    const vault = await createOfflineVault(password); password = ""; confirm = "";
    await writeJsonFile(directory, FILES.vault, vault);
    await writeJsonFile(directory, FILES.metadata, vault.public);
    console.log(`Vault created. Public address: ${vault.public.address}\nPublic metadata: ${FILES.metadata}\nKeep ${FILES.vault} encrypted. Shut down the offline environment before returning to Windows.`);
    return;
  }
  const vault = validateVault(await readJsonFile(directory, FILES.vault));
  if (command === "check-vault") {
    let password = await hidden("Vault passphrase (hidden): ");
    const address = await checkOfflineVaultPassword(vault, password); password = "";
    await assertOfflineEnvironment();
    console.log(`Vault passphrase verified. Address: ${address}\nNo transaction signed. No funds or request file needed. Fully shut down before removing USB.`); return;
  }
  if (command === "export-public") {
    await writeJsonFile(directory, FILES.metadata, vault.public, true); console.log("Public metadata restored. No password or private key exported."); return;
  }
  const request = validateRequest(await readJsonFile(directory, FILES.request));
  console.log(`FULL RECIPIENT: ${request.to}\nFrom: ${request.from}\nNetwork: Robinhood mainnet (4663)\nValue: ${formatEther(request.value)} ETH\nNonce: ${request.nonce}\nMaximum fee: ${formatEther(BigInt(request.gasLimit) * BigInt(request.maxFeePerGas))} ETH\nMaximum TOTAL debit: ${formatEther(BigInt(request.value) + BigInt(request.gasLimit) * BigInt(request.maxFeePerGas))} ETH\nRequest: ${request.requestId}\nApp deadline: ${request.expiresAt}\nFingerprint: ${request.fingerprint}\n\nVerify the full recipient against your independently known destination. Signing authorizes this exact payment; anyone holding its signed bytes can submit it. The app timer cannot revoke a signature.`);
  if (await ask("Type SIGN after reviewing all values: ") !== "SIGN") throw new Error("Cancelled. Nothing signed.");
  let password = await hidden("Vault passphrase (hidden): ");
  console.log("Unlocking and signing offline…");
  const response = await signOfflineVault(vault, password, request); password = "";
  await assertOfflineEnvironment();
  await writeJsonFile(directory, FILES.response, response, true);
  console.log(`Signed response verified and saved. Transaction hash: ${response.transactionHash}\nNo transaction was broadcast. Fully shut down, remove USB, boot Windows, resume the dashboard, then reconnect.`);
}

if (process.env.NODE_ENV !== "test") main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  const safePrefixes = ["Passphrases differ.", "Incorrect passphrase or damaged encrypted vault.", "Use a unique passphrase of", "Vault or public metadata already exists.", "Request expired.", "Invalid request lifetime or clock.", "Cancelled.", "Boot the DriveKey live image", "Real vault setup/signing is available only", "Network addresses detected.", "An active network interface", "Swap must be disabled"];
  console.error(safePrefixes.some(prefix => message.startsWith(prefix)) ? message : "Operation stopped. Check the offline environment, clock, request, passphrase, and available drive space. Existing vaults are never overwritten. Run again to retry.");
  process.exitCode = 1;
});
