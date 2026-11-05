// V8 is additive: legacy v3/v4/v6/v7 file readers remain available.
import { z } from 'zod';
import { Transaction as EthTransaction, Interface, getAddress, keccak256, verifyMessage, formatUnits } from 'ethers';
import { Transaction, PublicKey, SystemProgram } from '@solana/web3.js';
import { createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
export { multiPublicSchema } from './multi-protocol';

export const CHAINS = {
  ethereum: { family: 'ethereum', chainId: 1, native: 'ETH', decimals: 18, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  sepolia: { family: 'ethereum', chainId: 11155111, native: 'ETH', decimals: 18, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  solana: { family: 'solana', genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', native: 'SOL', decimals: 9, usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  devnet: { family: 'solana', genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', native: 'SOL', decimals: 9, usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' },
} as const;
export type Chain = keyof typeof CHAINS;
export const ERC20_PAYMENT = new Interface(['function transfer(address to,uint256 amount) returns(bool)', 'function balanceOf(address owner) view returns(uint256)', 'function decimals() view returns(uint8)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const units = z.string().regex(/^(0|[1-9][0-9]*)$/).max(39).refine(v => BigInt(v) < 2n ** 128n);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const schema = z.object({
  version: z.literal(8), action: z.literal('payment'), requestId: z.string().uuid(), deviceId: z.string().uuid(),
  chain: z.enum(['ethereum', 'sepolia', 'solana', 'devnet']), network: z.enum(['ethereum', 'solana']),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), from: z.string().max(64), recipient: z.string().max(64),
  asset: z.enum(['ETH', 'SOL', 'USDC']), amount: units, maximumFee: units, accountRent: units,
  createRecipientAccount: z.boolean(), blockhash: z.string().max(64).nullable(), lastValidBlockHeight: z.number().int().positive().nullable(),
  unsignedTransaction: z.string().max(8192), fingerprint: hash,
}).strict();
export type PaymentIntent = z.infer<typeof schema>;
const responseSchema = z.object({ version: z.literal(8), deviceId: z.string().uuid(), requestId: z.string().uuid(), fingerprint: hash,
  signedAt: z.string().datetime(), rawSignedTransaction: z.string().max(8192), transactionHash: z.string().max(100), approvalSignature: z.string().max(160) }).strict();
export type PaymentResponse = z.infer<typeof responseSchema>;
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function paymentFingerprint(r: any) { const { fingerprint, ...body } = r; return keccak256(new TextEncoder().encode('DriveKey payment intent v8\n' + canonical(body))); }
export function paymentApproval(r: PaymentIntent) { return 'DriveKey payment approval v8\n' + r.fingerprint; }
export function solPayment(r: Omit<PaymentIntent, 'fingerprint'> | PaymentIntent) {
  const sender = new PublicKey(r.from), recipient = new PublicKey(r.recipient), tx = new Transaction({ feePayer: sender, recentBlockhash: r.blockhash! });
  if (r.asset === 'SOL') tx.add(SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipient, lamports: BigInt(r.amount) }));
  else {
    const mint = new PublicKey(CHAINS[r.chain].usdc), source = getAssociatedTokenAddressSync(mint, sender), target = getAssociatedTokenAddressSync(mint, recipient);
    if (r.createRecipientAccount) tx.add(createAssociatedTokenAccountIdempotentInstruction(sender, target, recipient, mint));
    tx.add(createTransferCheckedInstruction(source, mint, target, sender, BigInt(r.amount), 6));
  }
  return tx;
}
export function validatePayment(input: unknown, now = Date.now(), checkExpiry = true): PaymentIntent {
  const r = schema.parse(input), chain = CHAINS[r.chain], created = Date.parse(r.createdAt), expiry = Date.parse(r.expiresAt);
  if (!Number.isSafeInteger(now) || expiry <= created || expiry - created > 15 * 60_000 || created > now + 60_000 || (checkExpiry && now >= expiry)) throw Error('Payment intent expired or clock invalid.');
  if (chain.family !== r.network || (r.asset !== chain.native && r.asset !== 'USDC') || BigInt(r.amount) <= 0n || BigInt(r.maximumFee) <= 0n) throw Error('Unsupported network, asset or amount.');
  if (paymentFingerprint(r) !== r.fingerprint) throw Error('Payment fingerprint mismatch.');
  if (r.network === 'ethereum') {
    if (getAddress(r.from) === getAddress(r.recipient) || getAddress(r.recipient) === '0x0000000000000000000000000000000000000000') throw Error('Invalid payment recipient.');
    if (r.blockhash !== null || r.lastValidBlockHeight !== null || r.createRecipientAccount || r.accountRent !== '0') throw Error('Unexpected Ethereum context.');
    const tx = EthTransaction.from(r.unsignedTransaction);
    const to = r.asset === 'ETH' ? r.recipient : chain.usdc, data = r.asset === 'ETH' ? '0x' : ERC20_PAYMENT.encodeFunctionData('transfer', [r.recipient, r.amount]);
    if (tx.signature || tx.type !== 2 || tx.chainId !== BigInt((chain as any).chainId) || tx.unsignedSerialized !== r.unsignedTransaction || !tx.to || getAddress(tx.to) !== getAddress(to) || tx.data !== data || tx.value !== (r.asset === 'ETH' ? BigInt(r.amount) : 0n) || tx.accessList?.length || tx.authorizationList?.length) throw Error('Ethereum payload differs from reviewed payment.');
    if (tx.nonce > 4294967295 || tx.gasLimit < 21000n || tx.gasLimit > 150000n || !tx.maxFeePerGas || tx.maxFeePerGas <= 0n || tx.maxPriorityFeePerGas === null || tx.maxPriorityFeePerGas < 0n || tx.maxPriorityFeePerGas > tx.maxFeePerGas || tx.gasLimit * tx.maxFeePerGas !== BigInt(r.maximumFee) || BigInt(r.maximumFee) > 10n ** 17n) throw Error('Ethereum fee or nonce policy exceeded.');
  } else {
    const sender = new PublicKey(r.from), recipient = new PublicKey(r.recipient);
    if (!PublicKey.isOnCurve(recipient.toBytes()) || sender.equals(recipient) || !r.blockhash || !r.lastValidBlockHeight || bs58.decode(r.blockhash).length !== 32) throw Error('Invalid Solana payment context.');
    if (BigInt(r.maximumFee) > 100000n || (r.createRecipientAccount ? r.asset !== 'USDC' || BigInt(r.accountRent) <= 0n || BigInt(r.accountRent) > 10000000n : r.accountRent !== '0')) throw Error('Solana fee or rent policy exceeded.');
    const expected = solPayment(r).serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    if (r.unsignedTransaction !== expected) throw Error('Solana payload contains unreviewed programs, accounts or permissions.');
  }
  return r;
}
export function paymentReview(input: unknown, now = Date.now(), checkExpiry = true): Record<string, string> {
  const r = validatePayment(input, now, checkExpiry), c = CHAINS[r.chain];
  return { action: r.action, requestId: r.requestId, deviceId: r.deviceId, network: r.network, chain: r.chain, from: r.from, recipient: r.recipient,
    asset: r.asset, tokenContract: r.asset === 'USDC' ? c.usdc : 'Native', amount: formatUnits(r.amount, r.asset === 'USDC' ? 6 : c.decimals) + ' ' + r.asset, baseUnits: r.amount,
    maximumFee: formatUnits(r.maximumFee,c.decimals)+' '+c.native, maximumFeeBaseUnits: r.maximumFee,
    recipientAccountRent: r.network==='solana'?formatUnits(r.accountRent,9)+' SOL':'None',accountRentBaseUnits: r.accountRent, deadlineUTC: r.expiresAt, fingerprint: r.fingerprint,
    ...(r.network === 'ethereum' ? { nonce: String(EthTransaction.from(r.unsignedTransaction).nonce) } : { blockhash: r.blockhash!, lastValidBlockHeight: String(r.lastValidBlockHeight), createRecipientAccount: String(r.createRecipientAccount) }),
    warning: 'Application expiry cannot revoke a signed transaction. Solana recent blockhashes may expire during file transfer. No replacement is signed automatically.' };
}
export function assertPaymentWallet(r: PaymentIntent, w: any) {
  if (r.deviceId !== w.deviceId || (r.network === 'ethereum' ? getAddress(r.from) !== getAddress(w.evmAddress) : r.from !== w.solanaAddress)) throw Error('Payment belongs to a different wallet.');
}
export function verifyPaymentResponse(input: unknown, request: unknown, wallet: any, now = Date.now(), checkExpiry = true) {
  const r = validatePayment(request, now, checkExpiry), s = responseSchema.parse(input); assertPaymentWallet(r, wallet);
  if (s.deviceId !== r.deviceId || s.requestId !== r.requestId || s.fingerprint !== r.fingerprint || Date.parse(s.signedAt) < Date.parse(r.createdAt) - 60000 || Date.parse(s.signedAt) >= Date.parse(r.expiresAt) || Date.parse(s.signedAt) > now + 60000) throw Error('Signed payment context mismatch.');
  if (r.network === 'ethereum') {
    const tx = EthTransaction.from(s.rawSignedTransaction);
    if (tx.from !== getAddress(r.from) || tx.unsignedSerialized !== r.unsignedTransaction || tx.hash !== s.transactionHash || getAddress(verifyMessage(paymentApproval(r), s.approvalSignature)) !== getAddress(r.from)) throw Error('Signed Ethereum payment differs from approval.');
  } else {
    const tx = Transaction.from(Buffer.from(s.rawSignedTransaction, 'base64'));
    if (tx.serialize().toString('base64') !== s.rawSignedTransaction || tx.signatures.length !== 1 || !tx.signature || !tx.verifySignatures() || tx.serializeMessage().toString('base64') !== solPayment(r).serializeMessage().toString('base64') || bs58.encode(tx.signature) !== s.transactionHash || !nacl.sign.detached.verify(new TextEncoder().encode(paymentApproval(r)), bs58.decode(s.approvalSignature), new PublicKey(r.from).toBytes())) throw Error('Signed Solana payment differs from approval.');
  }
  return s;
}
