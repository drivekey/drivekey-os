// Version 5 adds offline-signed nonce creation; existing RC8 v2/v3/v4 formats are unchanged.
import {z} from 'zod';
import {PublicKey,Transaction} from '@solana/web3.js';
import {keccak256} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {Buffer} from 'buffer';
import {multiPublicSchema,SOLANA_GENESIS} from './multi-protocol';
import {noncePublicKey,nonceAddress,nonceSeed,nonceCreationTransaction,unsignedNonceBytes,type NonceQuote} from './nonce-setup-protocol';
export const OFFLINE_NONCE_TTL=90_000;
const fingerprint=z.string().regex(/^0x[0-9a-f]{64}$/);
export const offlineNonceSchema=z.object({version:z.literal(5),kind:z.literal('nonce-setup'),network:z.literal('solana'),genesisHash:z.literal(SOLANA_GENESIS),requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),from:noncePublicKey,nonceAccount:noncePublicKey,seed:z.string().regex(/^[a-f0-9]{32}$/),depositLamports:z.number().int().positive().max(10_000_000),maximumFee:z.number().int().positive().max(100_000),blockhash:noncePublicKey,lastValidBlockHeight:z.number().int().nonnegative().safe(),unsignedTransaction:z.string().max(2400),fingerprint}).strict();
export type OfflineNonceRequest=z.infer<typeof offlineNonceSchema>;
export function offlineNonceQuote(r:OfflineNonceRequest):NonceQuote{return {version:1,kind:'drivekey-nonce-setup',genesisHash:r.genesisHash,deviceId:r.deviceId,authority:r.from,sponsor:r.from,nonceAccount:r.nonceAccount,seed:r.seed,depositLamports:r.depositLamports,feeLamports:r.maximumFee,blockhash:r.blockhash,lastValidBlockHeight:r.lastValidBlockHeight,unsignedTransaction:r.unsignedTransaction};}
export function offlineNonceTransaction(r:OfflineNonceRequest){return nonceCreationTransaction(offlineNonceQuote(r));}
export function offlineNonceFingerprint(r:OfflineNonceRequest){const {fingerprint:_ignored,...fields}=offlineNonceSchema.parse({...r,fingerprint:'0x'+'00'.repeat(32)});return keccak256(new TextEncoder().encode(JSON.stringify(fields)));}
export function offlineNonceApproval(r:OfflineNonceRequest){return new TextEncoder().encode('DriveKey offline nonce approval v5\n'+r.fingerprint);}
export async function validateOfflineNonce(input:unknown,now=Date.now(),fresh=true){
 const r=offlineNonceSchema.parse(input),created=Date.parse(r.createdAt),expiry=Date.parse(r.expiresAt);
 if(expiry<=created||expiry-created>OFFLINE_NONCE_TTL||created>now+10_000||(fresh&&now>=expiry))throw Error('Offline nonce request expired or has invalid timing. Prepare a fresh request.');
 if(!PublicKey.isOnCurve(new PublicKey(r.from).toBytes())||r.seed!==nonceSeed(r.from)||r.nonceAccount!==await nonceAddress(r.from,r.from))throw Error('Nonce payer, authority or derived destination does not match.');
 if(unsignedNonceBytes(offlineNonceTransaction(r))!==r.unsignedTransaction||offlineNonceFingerprint(r)!==r.fingerprint)throw Error('Nonce instructions, deposit, fee or approval context changed.');
 return r;
}
const responseSchema=z.object({version:z.literal(5),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint,signedAt:z.string().datetime(),rawSignedTransaction:z.string().max(2400),approvalSignature:z.string().max(90),transactionHash:z.string().max(90)}).strict();
export type OfflineNonceResponse=z.infer<typeof responseSchema>;
export async function verifyOfflineNonceResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),fresh=true){
 const r=await validateOfflineNonce(request,now,fresh),w=multiPublicSchema.parse(wallet),s=responseSchema.parse(input);
 if(w.deviceId!==r.deviceId||w.solanaAddress!==r.from||s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint)throw Error('Offline nonce response belongs to another request or wallet.');
 const time=Date.parse(s.signedAt);if(time<Date.parse(r.createdAt)||time>=Date.parse(r.expiresAt)||time>now+10_000)throw Error('Invalid offline nonce signing time.');
 const tx=Transaction.from(Buffer.from(s.rawSignedTransaction,'base64'));
 if(tx.serialize().toString('base64')!==s.rawSignedTransaction||!tx.serializeMessage().equals(offlineNonceTransaction(r).serializeMessage())||tx.signatures.length!==1||tx.signatures[0].publicKey.toBase58()!==r.from||!tx.signature||!tx.verifySignatures()||bs58.encode(tx.signature)!==s.transactionHash||!nacl.sign.detached.verify(offlineNonceApproval(r),bs58.decode(s.approvalSignature),new PublicKey(r.from).toBytes()))throw Error('Invalid or changed offline nonce signature.');
 return s;
}
export function offlineNonceReview(r:OfflineNonceRequest){return {network:'Solana mainnet',operation:'Create durable nonce — new ISO required',payer:r.from,authority:r.from,nonceAccount:r.nonceAccount,depositLamports:String(r.depositLamports),maximumFeeLamports:String(r.maximumFee),maximumDebitLamports:String(r.depositLamports+r.maximumFee),blockhash:r.blockhash,lastValidBlockHeight:String(r.lastValidBlockHeight),deadlineUTC:r.expiresAt,warning:'This creates an account, not a payment. The deposit remains locked until an authorized withdrawal. The recent blockhash may expire before return online. Never replace it in signed bytes.',fingerprint:r.fingerprint};}
