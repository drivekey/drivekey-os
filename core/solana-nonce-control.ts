import {z} from 'zod';
import {PublicKey,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {keccak256,formatUnits} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {SOLANA_GENESIS,multiPublicSchema} from './multi-protocol';
const pub=z.string().max(44).refine(v=>{try{return new PublicKey(v).toBase58()===v;}catch{return false;}}),digest=z.string().regex(/^0x[0-9a-f]{64}$/),units=z.string().regex(/^[1-9][0-9]{0,19}$/).refine(v=>BigInt(v)<=100000n);
const signature=z.string().max(88).refine(v=>{try{return bs58.decode(v).length===64&&bs58.encode(bs58.decode(v))===v;}catch{return false;}});
export const nonceControlSchema=z.object({version:z.literal(1),kind:z.literal('solana-nonce-invalidate'),network:z.literal('solana'),genesisHash:z.literal(SOLANA_GENESIS),requestId:z.string().uuid(),deviceId:z.string().uuid(),from:pub,nonceAccount:pub,nonceValue:pub,maximumFee:units,targetRequestFingerprint:digest,targetSignature:signature.nullable(),createdAt:z.string().datetime().max(64),expiresAt:z.string().datetime().max(64),unsignedMessage:z.string().max(1000),fingerprint:digest}).strict();
export type NonceControlRequest=z.infer<typeof nonceControlSchema>;
export const nonceControlResponseSchema=z.object({version:z.literal(1),kind:z.literal('solana-nonce-invalidate'),network:z.literal('solana'),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:digest,signedAt:z.string().datetime().max(64),rawSignedTransaction:z.string().max(1200),transactionHash:signature,approvalSignature:signature}).strict();
export function nonceControlFingerprint(input:Omit<NonceControlRequest,'fingerprint'>|NonceControlRequest){const fields=Object.entries(input).filter(([k])=>k!=='fingerprint').sort(([a],[b])=>a<b?-1:a>b?1:0);return keccak256(new TextEncoder().encode(JSON.stringify(['DriveKey Solana nonce invalidation v1',fields])));}
export function nonceControlApproval(r:NonceControlRequest){return new TextEncoder().encode('DriveKey Solana nonce invalidation approval v1\n'+r.fingerprint);}
export function nonceControlMessage(r:Pick<NonceControlRequest,'from'|'nonceAccount'|'nonceValue'>){const owner=new PublicKey(r.from);return new TransactionMessage({payerKey:owner,recentBlockhash:r.nonceValue,instructions:[SystemProgram.nonceAdvance({noncePubkey:new PublicKey(r.nonceAccount),authorizedPubkey:owner})]}).compileToLegacyMessage();}
export function validateNonceControl(input:unknown,now=Date.now(),fresh=true){
 const r=nonceControlSchema.parse(input),created=Date.parse(r.createdAt),expiry=Date.parse(r.expiresAt);
 if(!PublicKey.isOnCurve(new PublicKey(r.from).toBytes())||r.nonceAccount===r.from)throw Error('Invalid nonce owner or account.');
 if(expiry<=created||expiry-created>1800000||created>now+60000||(fresh&&now>=expiry))throw Error('Nonce invalidation request expired or has invalid timing.');
 if(nonceControlFingerprint(r)!==r.fingerprint||Buffer.from(nonceControlMessage(r).serialize()).toString('base64')!==r.unsignedMessage)throw Error('Nonce invalidation bytes or approval context changed.');return r;
}
export function verifyNonceControlResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),fresh=true){
 const r=validateNonceControl(request,now,fresh),w=multiPublicSchema.parse(wallet),s=nonceControlResponseSchema.parse(input);
 if(w.deviceId!==r.deviceId||w.solanaAddress!==r.from||s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint)throw Error('Nonce invalidation response belongs to another wallet or request.');
 const raw=Buffer.from(s.rawSignedTransaction,'base64'),tx=VersionedTransaction.deserialize(raw),message=tx.message.serialize();
 if(raw.toString('base64')!==s.rawSignedTransaction||raw.length>900||tx.message.version!=='legacy'||tx.signatures.length!==1||Buffer.from(message).toString('base64')!==r.unsignedMessage||bs58.encode(tx.signatures[0])!==s.transactionHash||!nacl.sign.detached.verify(message,tx.signatures[0],new PublicKey(r.from).toBytes())||!nacl.sign.detached.verify(nonceControlApproval(r),bs58.decode(s.approvalSignature),new PublicKey(r.from).toBytes()))throw Error('Invalid nonce-control signature or transaction.');
 const time=Date.parse(s.signedAt);if(time<createdTime(r)-60000||time>=Date.parse(r.expiresAt)||time>now+60000)throw Error('Invalid nonce-control signing time.');return s;
}
const createdTime=(r:NonceControlRequest)=>Date.parse(r.createdAt);
export function nonceControlReview(input:unknown,fresh=true){const r=validateNonceControl(input,Date.now(),fresh);return {action:'nonce-invalidate',network:'Solana mainnet',authority:r.from,nonceAccount:r.nonceAccount,oldNonce:r.nonceValue,targetRequest:r.targetRequestFingerprint,targetSignature:r.targetSignature??'Not yet signed',maximumFee:formatUnits(r.maximumFee,9)+' SOL',deadlineUTC:r.expiresAt,fingerprint:r.fingerprint,warning:'This advances the nonce only. It invalidates every transaction using this nonce value after confirmation. The original swap may win the race. A network fee applies; no rent is withdrawn.'};}
export function isNonceControlShape(v:unknown){return !!v&&typeof v==='object'&&'kind' in v&&v.kind==='solana-nonce-invalidate';}
