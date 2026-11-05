import { z } from "zod";
import { Interface, Transaction as EvmTransaction, getAddress, keccak256, verifyMessage, ZeroAddress } from "ethers";
import { PublicKey, SystemProgram, Transaction as SolTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { CHAIN_ID, MAX_FEE } from "./protocol";
import {robinhoodTokenIdentity,verifyRobinhoodTokenIdentity} from './robinhood-proxy-identity';

export const MULTI_TTL = 24 * 60 * 60_000;
export const SOLANA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const ERC20 = new Interface(["function transfer(address to,uint256 amount) returns(bool)", "function balanceOf(address) view returns(uint256)", "function decimals() view returns(uint8)", "function symbol() view returns(string)", "function name() view returns(string)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);
const quantity = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) < 2n ** 256n);
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v => { try { return getAddress(v) !== ZeroAddress; } catch { return false; } });
const pub = z.string().max(44).refine(v => { try { return new PublicKey(v).toBase58() === v; } catch { return false; } });
const digest = z.string().regex(/^0x[0-9a-f]{64}$/);
const common = { version: z.literal(3), requestId: z.string().uuid(), deviceId: z.string().uuid(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), fingerprint: digest };
export const multiPublicSchema = z.object({ version: z.literal(3), deviceId: z.string().uuid(), createdAt: z.string().datetime(), evmAddress: addr, solanaAddress: pub }).strict();
export type MultiPublic = z.infer<typeof multiPublicSchema>;
export const ercRequestSchema = z.object({ ...common, network: z.literal("robinhood"), chainId: z.literal(CHAIN_ID), standard: z.literal("erc20"), from: addr, recipient: addr, token: addr, amount: quantity, decimals: z.number().int().min(0).max(36), unsignedTransaction: z.string().max(4096).regex(/^0x[0-9a-f]+$/), codeHash: digest }).strict();
export const solRequestSchema = z.object({ ...common, network: z.literal("solana"), genesisHash: pub, standard: z.enum(["native", "spl"]), from: pub, recipient: pub, token: z.union([z.literal("native"), pub]), amount: quantity, decimals: z.number().int().min(0).max(18), nonceAccount: pub, nonceValue: pub, maximumFee: quantity, accountRent: quantity, createRecipientAccount: z.boolean(), unsignedTransaction: z.string().max(2000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
// v6 adds explicit implementation approval. v3 remains byte-for-byte compatible with RC8.
export const proxyErcRequestSchema=ercRequestSchema.extend({version:z.literal(6),implementation:addr,implementationCodeHash:digest}).strict();
export const multiRequestSchema = z.union([z.discriminatedUnion("network", [ercRequestSchema, solRequestSchema]),proxyErcRequestSchema]);
export type MultiRequest = z.infer<typeof multiRequestSchema>;
export type ErcRequest = z.infer<typeof ercRequestSchema>|z.infer<typeof proxyErcRequestSchema>;
export type SolRequest = z.infer<typeof solRequestSchema>;
export const multiResponseSchema = z.object({ version: z.union([z.literal(3),z.literal(6)]), requestId: z.string().uuid(), deviceId: z.string().uuid(), fingerprint: digest, signedAt: z.string().datetime(), rawSignedTransaction: z.string().max(4096), approvalSignature: z.string().max(132), transactionHash: z.string().max(90) }).strict();
export type MultiResponse = z.infer<typeof multiResponseSchema>;

export function multiFingerprint(r: Omit<MultiRequest, "fingerprint"> | MultiRequest): string {
  const entries = Object.entries(r).filter(([key]) => key !== "fingerprint").sort(([a], [b]) => a.localeCompare(b, "en"));
  return keccak256(new TextEncoder().encode(JSON.stringify([`DriveKey multi-asset v${r.version}`, entries])));
}
export function multiApproval(r: MultiRequest): string { return `DriveKey offline multi-asset approval v${r.version}\n${r.fingerprint}`; }

/** Construct only this tiny instruction allowlist; byte equality rejects all extra accounts/instructions. */
export function canonicalSolTransaction(r: SolRequest): SolTransaction {
  const from = new PublicKey(r.from), recipient = new PublicKey(r.recipient);
  const tx = new SolTransaction({ feePayer: from, recentBlockhash: r.nonceValue });
  tx.add(SystemProgram.nonceAdvance({ noncePubkey: new PublicKey(r.nonceAccount), authorizedPubkey: from }));
  if (r.standard === "native") tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: recipient, lamports: BigInt(r.amount) }));
  else {
    const mint = new PublicKey(r.token);
    const source = getAssociatedTokenAddressSync(mint, from);
    const destination = getAssociatedTokenAddressSync(mint, recipient);
    if (r.createRecipientAccount) tx.add(createAssociatedTokenAccountIdempotentInstruction(from, destination, recipient, mint));
    tx.add(createTransferCheckedInstruction(source, mint, destination, from, BigInt(r.amount), r.decimals, [], TOKEN_PROGRAM_ID));
  }
  return tx;
}
export function encodeSolUnsigned(tx: SolTransaction): string { return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"); }

export function validateMultiRequest(input: unknown, now = Date.now(), checkExpiry = true): MultiRequest {
  const r = multiRequestSchema.parse(input);
  if (Date.parse(r.expiresAt) - Date.parse(r.createdAt) !== MULTI_TTL || Date.parse(r.createdAt) > now + 60_000) throw new Error("Invalid request lifetime or clock.");
  if (checkExpiry && now >= Date.parse(r.expiresAt)) throw new Error("Request expired. Prepare a fresh request.");
  if (multiFingerprint(r) !== r.fingerprint) throw new Error("Request fingerprint mismatch.");
  if (BigInt(r.amount) <= 0n || r.from === r.recipient) throw new Error("Invalid transfer amount or self-transfer.");
  if (r.network === "robinhood") {
    if(r.version===6){
      const pin=robinhoodTokenIdentity(r.token);if(!pin||r.decimals!==pin.decimals)throw Error('Unsupported proxy token or decimals.');
      verifyRobinhoodTokenIdentity(r.token,r.codeHash,r.implementation,r.implementationCodeHash);
    }
    const tx = EvmTransaction.from(r.unsignedTransaction);
    if (tx.signature || tx.unsignedSerialized !== r.unsignedTransaction || tx.chainId !== BigInt(CHAIN_ID) || tx.type !== 2 || tx.value !== 0n || tx.accessList?.length || tx.authorizationList?.length) throw new Error("Unsupported EVM transaction.");
    if (!tx.to || getAddress(tx.to) !== getAddress(r.token) || getAddress(r.from) === getAddress(r.recipient)) throw new Error("Token contract or recipient mismatch.");
    const decoded = ERC20.decodeFunctionData("transfer", tx.data);
    const canonical = ERC20.encodeFunctionData("transfer", [decoded[0], decoded[1]]);
    if (canonical !== tx.data || getAddress(decoded[0]) !== getAddress(r.recipient) || decoded[1].toString() !== r.amount) throw new Error("Calldata is not the exact reviewed transfer.");
    if (tx.gasLimit < 21_000n || tx.gasLimit > 2_000_000n || !tx.maxFeePerGas || tx.maxFeePerGas <= 0n || tx.maxPriorityFeePerGas === null || tx.maxPriorityFeePerGas > tx.maxFeePerGas || tx.gasLimit * tx.maxFeePerGas > MAX_FEE || tx.nonce > 4_294_967_295) throw new Error("Fee or nonce policy exceeded.");
  } else {
    if (r.genesisHash !== SOLANA_GENESIS) throw new Error("Wrong Solana cluster identity.");
    if (BigInt(r.amount) > 2n ** 64n - 1n || BigInt(r.maximumFee) > 10_000_000n || BigInt(r.maximumFee) === 0n || BigInt(r.accountRent) > 10_000_000n) throw new Error("Solana quantity or fee policy exceeded.");
    if (r.nonceAccount === r.from || r.nonceAccount === r.recipient || r.nonceAccount === r.token) throw new Error("Nonce account aliases a transfer account.");
    if (r.standard === "native" && (r.token !== "native" || r.decimals !== 9 || r.createRecipientAccount || r.accountRent !== "0")) throw new Error("Invalid native SOL request.");
    if (r.standard === "spl" && (r.token === "native" || (r.createRecipientAccount ? BigInt(r.accountRent) <= 0n : r.accountRent !== "0"))) throw new Error("Invalid SPL account creation context.");
    // Legacy messages only; reconstruction includes all flags, fee payer, signers and programs.
    const expected = encodeSolUnsigned(canonicalSolTransaction(r));
    if (r.unsignedTransaction !== expected) throw new Error("Solana bytes contain unsupported instructions, accounts, signers or amounts.");
  }
  return r;
}

export function verifyMultiResponse(input: unknown, request: unknown, publicInput: unknown, now = Date.now(), checkExpiry = true): MultiResponse {
  const r = validateMultiRequest(request, now, checkExpiry), w = multiPublicSchema.parse(publicInput), s = multiResponseSchema.parse(input);
  if(s.version!==r.version)throw Error('Response approval version mismatch.');
  if (r.deviceId !== w.deviceId || s.deviceId !== w.deviceId || s.requestId !== r.requestId || s.fingerprint !== r.fingerprint) throw new Error("Response context mismatch.");
  if (Date.parse(s.signedAt) < Date.parse(r.createdAt) - 60_000 || Date.parse(s.signedAt) >= Date.parse(r.expiresAt) || Date.parse(s.signedAt) > now + 60_000) throw new Error("Invalid signing time.");
  if (r.network === "robinhood") {
    const tx = EvmTransaction.from(s.rawSignedTransaction);
    if (getAddress(r.from) !== getAddress(w.evmAddress) || tx.from !== getAddress(w.evmAddress) || tx.unsignedSerialized !== r.unsignedTransaction || tx.hash !== s.transactionHash || getAddress(verifyMessage(multiApproval(r), s.approvalSignature)) !== getAddress(w.evmAddress)) throw new Error("Wrong EVM signer or altered signed transaction.");
  } else {
    const tx = SolTransaction.from(Buffer.from(s.rawSignedTransaction, "base64"));
    if (r.from !== w.solanaAddress || tx.serialize().toString("base64") !== s.rawSignedTransaction || tx.serializeMessage().toString("base64") !== canonicalSolTransaction(r).serializeMessage().toString("base64") || tx.signatures.length !== 1 || !tx.signature || !tx.verifySignatures() || bs58.encode(tx.signature) !== s.transactionHash) throw new Error("Wrong Solana signer or altered signed transaction.");
    if (!nacl.sign.detached.verify(new TextEncoder().encode(multiApproval(r)), bs58.decode(s.approvalSignature), new PublicKey(w.solanaAddress).toBytes())) throw new Error("Solana approval context mismatch.");
  }
  return s;
}

export function multiReview(input: unknown, checkExpiry = true): Record<string, string> {
  const r = validateMultiRequest(input, Date.now(), checkExpiry);
  const review: Record<string, string> = { network: r.network === "robinhood" ? "Robinhood Chain / 4663" : "Solana / genesis " + r.genesisHash, from: r.from, recipient: r.recipient, asset: r.token, baseUnits: r.amount, decimals: String(r.decimals), expiryUTC: r.expiresAt, fingerprint: r.fingerprint, warning: "Token identity/decimals and chain state require independent verification. Application expiry cannot revoke signed bytes." };
  if (r.network === "robinhood") {
    const tx = EvmTransaction.from(r.unsignedTransaction);
    if(r.version===6){review.signerRequirement=`${robinhoodTokenIdentity(r.token)!.signer} or later verified ISO for this token`;review.proxyCodeHash=r.codeHash;review.implementation=r.implementation;review.implementationCodeHash=r.implementationCodeHash;review.proxyWarning='Upgradeable token. Online preflight must recheck this exact implementation. Approval cannot prevent an upgrade after preflight.';}
    review.maximumFeeWei = (tx.gasLimit * tx.maxFeePerGas!).toString(); review.nonce = String(tx.nonce); review.calldata = tx.data;
    review.metadataTrust = "ERC-20 decimals are online-supplied; calldata proves recipient and base units, not token legitimacy.";
  } else { review.maximumFeeLamports = r.maximumFee; review.accountRentLamports = r.accountRent; review.nonceAccount = r.nonceAccount; review.nonceValue = r.nonceValue; review.instructions = r.standard === "native" ? "Advance durable nonce; transfer SOL" : "Advance durable nonce; " + (r.createRecipientAccount ? "create recipient ATA; " : "") + "SPL TransferChecked"; }
  return review;
}
