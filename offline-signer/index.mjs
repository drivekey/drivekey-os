#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Transaction, Wallet, formatEther, formatUnits, getAddress, keccak256, parseEther } from "ethers";
import { z } from "zod";

const CHAIN_ID = 4663;
const MAX_VALUE_WEI = parseEther("0.005");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+$/);

const requestSchema = z.object({
  version: z.literal(1),
  requestId: z.string().uuid(),
  deviceId: z.string().min(1).max(128),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  chainId: z.literal(CHAIN_ID),
  from: address,
  to: address,
  value: decimal,
  nonce: decimal,
  gasLimit: decimal,
  type: z.literal(2),
  maxFeePerGas: decimal,
  maxPriorityFeePerGas: decimal,
  unsignedTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/),
  fingerprint: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();

export function computeRequestFingerprint(request) {
  const canonical = [
    request.chainId,
    getAddress(request.from),
    getAddress(request.to),
    BigInt(request.value),
    BigInt(request.nonce),
    BigInt(request.gasLimit),
    request.type,
    BigInt(request.maxFeePerGas),
    BigInt(request.maxPriorityFeePerGas),
    request.unsignedTransaction,
  ].map(String).join("\n");
  return keccak256(new TextEncoder().encode(canonical));
}

export function verifyUnsignedRequest(input, now = Date.now()) {
  const request = requestSchema.parse(input);
  if (Date.parse(request.expiresAt) <= now) throw new Error("The request has expired. Build a fresh request online.");
  if (Date.parse(request.expiresAt) - Date.parse(request.createdAt) !== 5 * 60_000) throw new Error("The request does not have the required five-minute lifetime.");
  if (BigInt(request.value) <= 0n || BigInt(request.value) > MAX_VALUE_WEI) throw new Error("Transfer value is outside the permitted range.");
  if (computeRequestFingerprint(request).toLowerCase() !== request.fingerprint.toLowerCase()) throw new Error("Fingerprint mismatch. Do not sign this request.");

  const tx = Transaction.from(request.unsignedTransaction);
  if (tx.signature) throw new Error("The request unexpectedly contains a signed transaction.");
  if (tx.unsignedSerialized !== request.unsignedTransaction) throw new Error("Unsigned transaction bytes are not canonical.");
  if (Number(tx.chainId) !== request.chainId || tx.type !== request.type) throw new Error("Transaction network or type mismatch.");
  if (!tx.to || getAddress(tx.to) !== getAddress(request.to)) throw new Error("Recipient mismatch.");
  if (tx.value.toString() !== request.value) throw new Error("Value mismatch.");
  if (tx.nonce.toString() !== request.nonce) throw new Error("Nonce mismatch.");
  if (tx.gasLimit.toString() !== request.gasLimit) throw new Error("Gas-limit mismatch.");
  if (tx.maxFeePerGas?.toString() !== request.maxFeePerGas) throw new Error("Maximum-fee mismatch.");
  if (tx.maxPriorityFeePerGas?.toString() !== request.maxPriorityFeePerGas) throw new Error("Priority-fee mismatch.");
  if (tx.data !== "0x" || (tx.accessList?.length ?? 0) !== 0) throw new Error("Only plain native ETH transfers are allowed.");
  return { request, tx };
}

export async function signUnsignedRequest(input, privateKey, now = new Date()) {
  const { request, tx } = verifyUnsignedRequest(input, now.getTime());
  const wallet = new Wallet(privateKey.trim());
  if (getAddress(wallet.address) !== getAddress(request.from)) throw new Error("Private key does not match the request sender.");
  const rawSignedTransaction = await wallet.signTransaction(tx);
  const signed = Transaction.from(rawSignedTransaction);
  if (signed.unsignedSerialized !== request.unsignedTransaction) throw new Error("Signed transaction does not preserve the exact unsigned bytes.");
  return {
    version: 1,
    requestId: request.requestId,
    deviceId: request.deviceId,
    rawSignedTransaction,
    signer: getAddress(wallet.address),
    transactionHash: signed.hash,
    signedAt: now.toISOString(),
  };
}

function printRequest(request) {
  const maximumFee = BigInt(request.gasLimit) * BigInt(request.maxFeePerGas);
  stdout.write("\nDRIVEKEY OFFLINE SIGNER — ROBINHOOD CHAIN MAINNET\n");
  stdout.write("Keep this machine disconnected from every network.\n\n");
  stdout.write(`Request ID       ${request.requestId}\n`);
  stdout.write(`Device ID        ${request.deviceId}\n`);
  stdout.write(`Chain ID         ${request.chainId}\n`);
  stdout.write(`From             ${getAddress(request.from)}\n`);
  stdout.write(`To               ${getAddress(request.to)}\n`);
  stdout.write(`Value            ${formatEther(request.value)} ETH\n`);
  stdout.write(`Nonce            ${request.nonce}\n`);
  stdout.write(`Gas limit        ${request.gasLimit}\n`);
  stdout.write(`Max fee / gas    ${formatUnits(request.maxFeePerGas, "gwei")} gwei\n`);
  stdout.write(`Priority / gas   ${formatUnits(request.maxPriorityFeePerGas, "gwei")} gwei\n`);
  stdout.write(`Maximum fee      ${formatEther(maximumFee)} ETH\n`);
  stdout.write(`Expires          ${request.expiresAt}\n`);
  stdout.write(`Fingerprint      ${request.fingerprint}\n\n`);
}

async function promptHidden(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") throw new Error("A private key may only be entered in an interactive terminal.");
  stdout.write(question);
  stdin.resume();
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return await new Promise((resolvePromise, rejectPromise) => {
    let value = "";
    const finish = (error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Signing cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") { value = value.slice(0, -1); continue; }
        if (/^[0-9a-fA-Fx]$/.test(character)) value += character;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const requestPath = args[0];
  if (!requestPath) throw new Error("Usage: pnpm sign-offline -- <drivekey-request.json> [drivekey-signed.json]");
  const inputPath = resolve(requestPath);
  const outputPath = args[1] ? resolve(args[1]) : resolve(dirname(inputPath), "drivekey-signed.json");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const { request } = verifyUnsignedRequest(input);
  printRequest(request);

  const rl = createInterface({ input: stdin, output: stdout });
  const confirmation = await rl.question("Verify the values above on a trusted display. Type SIGN to continue: ");
  rl.close();
  if (confirmation !== "SIGN") throw new Error("Signing cancelled.");

  let privateKey = await promptHidden("Private key (masked, never written to disk): ");
  try {
    const response = await signUnsignedRequest(request, privateKey);
    await writeFile(outputPath, JSON.stringify(response, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    stdout.write(`Signed response written to ${outputPath}\n`);
    stdout.write(`Transaction hash: ${response.transactionHash}\n`);
    stdout.write("Move the response to the online DriveKey dashboard. This signer never broadcasts.\n");
  } finally {
    privateKey = "";
  }
}

if (process.argv[1] && basename(process.argv[1]) === basename(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Offline signing failed.";
    process.stderr.write(`ERROR: ${message}\n`);
    process.exitCode = 1;
  });
}
