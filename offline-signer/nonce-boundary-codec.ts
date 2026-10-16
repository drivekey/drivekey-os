// Bounded private transport; existing nonce-setup v5 JSON and signatures stay unchanged.
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {z} from 'zod';
import {offlineNonceSchema,type OfflineNonceRequest} from '../core/offline-nonce-protocol';
import {SOLANA_GENESIS} from '../core/multi-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_NONCE_REQUEST_FRAME=12288,MAX_NONCE_SIGN_FRAME=14336,MAX_NONCE_RESPONSE_FRAME=3072;
export class Writer{
 private chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 number(n:number,size:2|4|8){if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid boundary integer.');const b=Buffer.alloc(size);if(size===8)b.writeBigUInt64BE(BigInt(n));else if(size===4)b.writeUInt32BE(n);else b.writeUInt16BE(n);this.chunks.push(b);}
 field(b:Uint8Array,max:number){if(b.length>max)throw Error('Boundary field exceeds limit.');this.number(b.length,2);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b)!==s)throw Error('Lossy boundary text.');this.field(b,max);}finally{b.fill(0);}}
 publicKey(s:string){this.bytes(new PublicKey(s).toBytes());}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Boundary frame exceeds limit.');}return b;}finally{for(const b of this.chunks)b.fill(0);}}
}
export class Reader{
 private at=0;
 constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Boundary frame exceeds limit.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||this.at+n>this.b.length)throw Error('Truncated boundary frame.');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 number(size:2|4|8){const b=this.bytes(size),n=size===8?b.readBigUInt64BE():BigInt(size===4?b.readUInt32BE():b.readUInt16BE());if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Boundary integer exceeds safe precision.');return Number(n);}
 field(max:number){const n=this.number(2);if(n>max)throw Error('Boundary field exceeds limit.');return this.bytes(n);}
 text(max:number){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.field(max));}
 publicKey(){return new PublicKey(this.bytes(32)).toBase58();}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s,'ascii')))throw Error('Wrong boundary purpose/version.');}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
export function isNonceTradeShape(value:unknown):boolean{return !!value&&typeof value==='object'&&'version' in value&&value.version===5;}
export function encodeNonceRequestFrame(input:unknown){const r=offlineNonceSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKNONRQ5'));w.text(r.requestId,36);w.text(r.deviceId,36);w.text(r.createdAt,4096);w.text(r.expiresAt,4096);w.publicKey(r.from);w.publicKey(r.nonceAccount);w.bytes(Buffer.from(r.seed,'hex'));w.number(r.depositLamports,4);w.number(r.maximumFee,4);w.publicKey(r.blockhash);w.number(r.lastValidBlockHeight,8);w.text(r.unsignedTransaction,2400);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));return w.finish(MAX_NONCE_REQUEST_FRAME);}
export function decodeNonceRequestFrame(frame:Buffer):OfflineNonceRequest{const r=new Reader(frame,MAX_NONCE_REQUEST_FRAME);r.magic('DKNONRQ5');const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.publicKey(),nonceAccount=r.publicKey(),seed=r.bytes(16).toString('hex'),depositLamports=r.number(4),maximumFee=r.number(4),blockhash=r.publicKey(),lastValidBlockHeight=r.number(8),unsignedTransaction=r.text(2400),fingerprint=digest(r);r.end();return offlineNonceSchema.parse({version:5,kind:'nonce-setup',network:'solana',genesisHash:SOLANA_GENESIS,requestId,deviceId,createdAt,expiresAt,from,nonceAccount,seed,depositLamports,maximumFee,blockhash,lastValidBlockHeight,unsignedTransaction,fingerprint});}
export function encodeNonceSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid nonce signing command.');const w=new Writer();w.bytes(Buffer.from('DKNONKY5'));w.field(encodeNonceRequestFrame(request),MAX_NONCE_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_NONCE_SIGN_FRAME);}
export function decodeNonceSigningFrame(frame:Buffer){const r=new Reader(frame,MAX_NONCE_SIGN_FRAME);r.magic('DKNONKY5');const request=decodeNonceRequestFrame(r.field(MAX_NONCE_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};}
const responseSchema=z.object({version:z.literal(5),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),signedAt:z.string().datetime().max(64),rawSignedTransaction:z.string().max(2400),transactionHash:z.string().max(90),approvalSignature:z.string().max(90)}).strict();
function signature(s:string){const b=bs58.decode(s);if(b.length!==64||bs58.encode(b)!==s)throw Error('Invalid signature encoding.');return b;}
export function encodeNonceResponseFrame(input:unknown){const s=responseSchema.parse(input),raw=Buffer.from(s.rawSignedTransaction,'base64');if(raw.toString('base64')!==s.rawSignedTransaction||raw.length>1232)throw Error('Invalid transaction encoding.');const w=new Writer();w.bytes(Buffer.from('DKNONRS5'));w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);w.field(raw,1232);w.bytes(signature(s.transactionHash));w.bytes(signature(s.approvalSignature));return w.finish(MAX_NONCE_RESPONSE_FRAME);}
export function decodeNonceResponseFrame(frame:Buffer){const r=new Reader(frame,MAX_NONCE_RESPONSE_FRAME);r.magic('DKNONRS5');const requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64),rawSignedTransaction=r.field(1232).toString('base64'),transactionHash=bs58.encode(r.bytes(64)),approvalSignature=bs58.encode(r.bytes(64));r.end();return responseSchema.parse({version:5,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,transactionHash,approvalSignature});}
export function decodeNonceRouteFrame(frame:Buffer){if(frame.length!==9||!frame.subarray(0,8).equals(Buffer.from('DKNONRT5'))||frame[8]>1)throw Error('Invalid nonce routing reply.');return frame[8]===1;}
