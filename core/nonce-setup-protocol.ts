import { z } from "zod";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { keccak256 } from "ethers";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { multiPublicSchema, SOLANA_GENESIS, type MultiPublic } from "./multi-protocol";

export const noncePublicKey = z.string().max(44).refine(v => {
  try { return new PublicKey(v).toBase58() === v; } catch { return false; }
}, "Enter a complete Solana public address.");
const lamports = z.number().int().positive().safe();
export const nonceQuoteSchema = z.object({
  version: z.literal(1), kind: z.literal("drivekey-nonce-setup"),
  genesisHash: z.literal(SOLANA_GENESIS), deviceId: z.string().uuid(),
  authority: noncePublicKey, sponsor: noncePublicKey, nonceAccount: noncePublicKey,
  seed: z.string().regex(/^[a-f0-9]{32}$/),
  depositLamports: lamports.max(10_000_000), feeLamports: lamports.max(100_000),
  blockhash: noncePublicKey, lastValidBlockHeight: z.number().int().nonnegative().safe(),
  unsignedTransaction: z.string().max(2400),
}).strict();
export type NonceQuote = z.infer<typeof nonceQuoteSchema>;
export function nonceSeed(authority: string) {
  return keccak256(new TextEncoder().encode("DriveKey nonce setup v1:" + authority)).slice(2,34);
}
export async function nonceAddress(sponsor: string, authority: string) {
  return (await PublicKey.createWithSeed(new PublicKey(sponsor), nonceSeed(authority), SystemProgram.programId)).toBase58();
}
export function nonceCreationTransaction(q: NonceQuote) {
  const payer = new PublicKey(q.sponsor);
  const tx = SystemProgram.createNonceAccount({
    fromPubkey: payer, basePubkey: payer, seed: q.seed,
    noncePubkey: new PublicKey(q.nonceAccount), authorizedPubkey: new PublicKey(q.authority),
    lamports: q.depositLamports,
  });
  tx.feePayer = payer; tx.recentBlockhash = q.blockhash;
  return tx;
}
export function unsignedNonceBytes(tx: Transaction) {
  return tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString("base64");
}
export async function validateNonceQuote(input: unknown, publicInput: unknown): Promise<NonceQuote> {
  const q = nonceQuoteSchema.parse(input), w = multiPublicSchema.parse(publicInput);
  if(q.deviceId !== w.deviceId || q.authority !== w.solanaAddress) throw Error("Nonce authority does not match your offline wallet.");
  if(q.sponsor === q.authority || !PublicKey.isOnCurve(new PublicKey(q.sponsor).toBytes())) throw Error("Use a separate funding wallet, never import your USB key.");
  if(q.seed !== nonceSeed(q.authority) || q.nonceAccount !== await nonceAddress(q.sponsor,q.authority)) throw Error("Nonce destination mismatch.");
  if(unsignedNonceBytes(nonceCreationTransaction(q)) !== q.unsignedTransaction) throw Error("Setup transaction contains changed instructions, authority or deposit.");
  return q;
}
export async function verifyNonceSigned(raw: string, input: unknown, wallet: MultiPublic) {
  const q = await validateNonceQuote(input,wallet);
  if(raw.length > 2400) throw Error("Signed setup file exceeds limits.");
  const tx = Transaction.from(Buffer.from(raw,"base64"));
  if(tx.serialize().toString("base64") !== raw ||
    !tx.serializeMessage().equals(nonceCreationTransaction(q).serializeMessage()) ||
    tx.signatures.length !== 1 || !tx.signature || !tx.verifySignatures() ||
    tx.signatures[0].publicKey.toBase58() !== q.sponsor)
    throw Error("Funding wallet returned a changed or invalid setup transaction.");
  return {quote:q,hash:bs58.encode(tx.signature),transaction:tx};
}
export function solDisplay(lamports: number) {
  return (lamports / 1_000_000_000).toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
}
