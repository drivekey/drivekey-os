import { Transaction, ZeroAddress, getAddress, keccak256, parseEther, toQuantity, verifyMessage } from "ethers";
import { z } from "zod";

export const CHAIN_ID = 4663 as const;
export const TTL_MS = 20 * 60_000;
export const MAX_VALUE = parseEther("0.005");
export const MAX_FEE = parseEther("0.001");
export const MAX_JSON_BYTES = 32_768;
export const FILES = { metadata: "wallet-public.json", request: "unsigned-request.json", response: "signed-response.json", vault: "vault-encrypted.json" } as const;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const quantity = z.string().max(24).regex(/^(0|[1-9][0-9]*)$/);
const hex = z.string().max(4096).regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const metadataSchema = z.object({ version: z.literal(2), chainId: z.literal(CHAIN_ID), address, deviceId: z.string().uuid(), createdAt: z.string().datetime() }).strict();
export const requestSchema = z.object({
  version: z.literal(2), chainId: z.literal(CHAIN_ID), requestId: z.string().uuid(), deviceId: z.string().uuid(),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), from: address, to: address,
  value: quantity, nonce: quantity, gasLimit: quantity, maxFeePerGas: quantity, maxPriorityFeePerGas: quantity,
  type: z.literal(2), unsignedTransaction: hex, fingerprint: hash,
}).strict();
export const responseSchema = z.object({
  version: z.literal(2), requestId: z.string().uuid(), deviceId: z.string().uuid(), fingerprint: hash,
  rawSignedTransaction: hex, approvalSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  signer: address, transactionHash: hash, signedAt: z.string().datetime(),
}).strict();
export type PublicWallet = z.infer<typeof metadataSchema>;
export type TransferRequest = z.infer<typeof requestSchema>;
export type SignedResponseV2 = z.infer<typeof responseSchema>;
export type Rpc = (method: string, params?: unknown[]) => Promise<unknown>;

export function parseJson(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new Error("File exceeds the 32 KB limit.");
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON file."); }
}

export function publicWallet(input: unknown): PublicWallet {
  const wallet = metadataSchema.parse(input);
  if (getAddress(wallet.address) === ZeroAddress) throw new Error("Invalid wallet address.");
  return { ...wallet, address: getAddress(wallet.address) };
}

export function fingerprint(r: Omit<TransferRequest, "fingerprint"> | TransferRequest): string {
  // Bind IDs and the application window as well as the canonical spending bytes.
  const context = ["DriveKey request v2", r.version, r.chainId, r.requestId, r.deviceId, r.createdAt, r.expiresAt,
    getAddress(r.from), getAddress(r.to), r.value, r.nonce, r.gasLimit, r.maxFeePerGas, r.maxPriorityFeePerGas, r.type, r.unsignedTransaction];
  return keccak256(new TextEncoder().encode(JSON.stringify(context)));
}

export function approvalMessage(r: TransferRequest): string { return `DriveKey offline approval v2\n${r.fingerprint}`; }

export function validateRequest(input: unknown, now = Date.now(), checkExpiry = true): TransferRequest {
  const r = requestSchema.parse(input);
  const created = Date.parse(r.createdAt), expires = Date.parse(r.expiresAt);
  if (expires - created !== TTL_MS || created > now + 60_000) throw new Error("Invalid request lifetime or clock. Check the offline clock.");
  if (checkExpiry && now >= expires) throw new Error("Request expired. Prepare a fresh request and approve it offline.");
  if (BigInt(r.value) <= 0n || BigInt(r.value) > MAX_VALUE) throw new Error("Transfer must be between 0 and 0.005 ETH.");
  if (BigInt(r.nonce) > 4_294_967_295n) throw new Error("Nonce is out of range.");
  if (BigInt(r.gasLimit) < 21_000n || BigInt(r.gasLimit) > 2_000_000n) throw new Error("Gas limit is out of range.");
  if (BigInt(r.maxFeePerGas) <= 0n || BigInt(r.maxPriorityFeePerGas) > BigInt(r.maxFeePerGas)) throw new Error("Invalid fee parameters.");
  if (BigInt(r.gasLimit) * BigInt(r.maxFeePerGas) > MAX_FEE) throw new Error("Maximum network fee exceeds 0.001 ETH.");
  if (getAddress(r.to) === ZeroAddress) throw new Error("Cannot send to the zero address.");
  if (fingerprint(r) !== r.fingerprint) throw new Error("Request fingerprint mismatch.");
  const tx = Transaction.from(r.unsignedTransaction);
  if (tx.signature || tx.unsignedSerialized !== r.unsignedTransaction) throw new Error("Request is not canonical unsigned transaction bytes.");
  if (tx.type !== 2 || tx.chainId !== BigInt(CHAIN_ID) || tx.data !== "0x" || (tx.accessList?.length ?? 0) !== 0 || (tx.authorizationList?.length ?? 0) !== 0) throw new Error("Only plain Robinhood mainnet ETH transfers are supported.");
  if (!tx.to || getAddress(tx.to) !== getAddress(r.to) || tx.value.toString() !== r.value || tx.nonce.toString() !== r.nonce ||
    tx.gasLimit.toString() !== r.gasLimit || tx.maxFeePerGas?.toString() !== r.maxFeePerGas || tx.maxPriorityFeePerGas?.toString() !== r.maxPriorityFeePerGas) throw new Error("Transaction bytes do not match the displayed request.");
  return r;
}

export function verifyResponse(input: unknown, inputRequest: unknown, inputWallet: unknown, now = Date.now(), checkExpiry = true): SignedResponseV2 {
  const r = validateRequest(inputRequest, now, checkExpiry), w = publicWallet(inputWallet), s = responseSchema.parse(input);
  if (getAddress(r.from) !== w.address || r.deviceId !== w.deviceId || s.deviceId !== w.deviceId || s.requestId !== r.requestId || s.fingerprint !== r.fingerprint) throw new Error("Signed response belongs to a different request or vault.");
  const tx = Transaction.from(s.rawSignedTransaction);
  if (!tx.signature || !tx.from || getAddress(tx.from) !== w.address || getAddress(s.signer) !== w.address || tx.hash !== s.transactionHash || tx.unsignedSerialized !== r.unsignedTransaction) throw new Error("Invalid signer, transaction hash, or signed transaction bytes.");
  if (getAddress(verifyMessage(approvalMessage(r), s.approvalSignature)) !== w.address) throw new Error("Offline approval does not match this exact request context.");
  if (Date.parse(s.signedAt) < Date.parse(r.createdAt) - 60_000 || Date.parse(s.signedAt) > now + 60_000 || Date.parse(s.signedAt) >= Date.parse(r.expiresAt)) throw new Error("Invalid signing timestamp.");
  return s;
}

function rpcNumber(input: unknown): bigint {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{1,32}$/.test(input)) throw new Error("RPC returned invalid numeric data.");
  return BigInt(input);
}

export async function prepareRequest(inputWallet: unknown, recipient: string, amount: string, rpc: Rpc, now = Date.now()): Promise<TransferRequest> {
  const w = publicWallet(inputWallet), to = getAddress(recipient);
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(amount)) throw new Error("Enter an ETH amount with at most 18 decimal places.");
  const value = parseEther(amount);
  if (value <= 0n || value > MAX_VALUE || to === ZeroAddress) throw new Error("Use a valid recipient and an amount up to 0.005 ETH.");
  if (rpcNumber(await rpc("eth_chainId")) !== BigInt(CHAIN_ID)) throw new Error("RPC is connected to the wrong network.");
  const [nonce, gas, block, tip, code, balance] = await Promise.all([
    rpc("eth_getTransactionCount", [w.address, "pending"]),
    rpc("eth_estimateGas", [{ from: w.address, to, value: toQuantity(value), data: "0x" }]),
    rpc("eth_getBlockByNumber", ["latest", false]), rpc("eth_maxPriorityFeePerGas"),
    rpc("eth_getCode", [to, "latest"]), rpc("eth_getBalance", [w.address, "pending"]),
  ]);
  if (code !== "0x") throw new Error("Contract and delegated-account recipients are outside this MVP. Use a plain wallet address.");
  const nonceValue = rpcNumber(nonce), gasLimit = rpcNumber(gas), priority = rpcNumber(tip);
  if (nonceValue > 4_294_967_295n) throw new Error("Nonce is out of range.");
  const base = rpcNumber((block as { baseFeePerGas?: unknown })?.baseFeePerGas), maxFee = base * 2n + priority;
  if (rpcNumber(balance) < value + gasLimit * maxFee) throw new Error("Insufficient ETH for the amount and maximum network fee.");
  const tx = Transaction.from({ chainId: CHAIN_ID, type: 2, to, value, nonce: Number(nonceValue), gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority, data: "0x" });
  const r: TransferRequest = { version: 2, chainId: CHAIN_ID, requestId: crypto.randomUUID(), deviceId: w.deviceId,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL_MS).toISOString(), from: w.address, to,
    value: value.toString(), nonce: nonceValue.toString(), gasLimit: gasLimit.toString(), maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: priority.toString(),
    type: 2, unsignedTransaction: tx.unsignedSerialized, fingerprint: "" };
  r.fingerprint = fingerprint(r);
  return validateRequest(r, now);
}

export async function preflight(r: TransferRequest, rpc: Rpc): Promise<void> {
  validateRequest(r);
  const [chain, nonce, balance, code, block, gas] = await Promise.all([
    rpc("eth_chainId"), rpc("eth_getTransactionCount", [r.from, "pending"]), rpc("eth_getBalance", [r.from, "pending"]),
    rpc("eth_getCode", [r.to, "latest"]), rpc("eth_getBlockByNumber", ["latest", false]),
    rpc("eth_estimateGas", [{ from: r.from, to: r.to, value: toQuantity(BigInt(r.value)), data: "0x" }]),
  ]);
  if (rpcNumber(chain) !== BigInt(CHAIN_ID)) throw new Error("Wrong network.");
  if (rpcNumber(nonce) !== BigInt(r.nonce)) throw new Error("Nonce changed. Reconcile your activity before creating a new request.");
  if (code !== "0x") throw new Error("Recipient now contains contract code. Transfer stopped.");
  if (rpcNumber(balance) < BigInt(r.value) + BigInt(r.gasLimit) * BigInt(r.maxFeePerGas)) throw new Error("Insufficient balance for the approved maximum debit.");
  if (rpcNumber((block as { baseFeePerGas?: unknown })?.baseFeePerGas) > BigInt(r.maxFeePerGas) || rpcNumber(gas) > BigInt(r.gasLimit)) throw new Error("Network fees changed. Prepare and sign a new request; signed fees cannot be changed.");
}
