import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {expiringJupiterSchema,expiringJupiterResponseSchema} from '../core/jupiter-expiring-protocol';
import {encodeJupiterRequestFrame,decodeJupiterRequestFrame} from './jupiter-boundary-codec';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_EXPIRING_JUPITER_REQUEST_FRAME=28800,MAX_EXPIRING_JUPITER_SIGN_FRAME=31000,MAX_EXPIRING_JUPITER_RESPONSE_FRAME=2048;
class Frame{
 private at=0;
 constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Guarded frame exceeds limit.');}
 take(n:number){if(n<0||this.at+n>this.b.length)throw Error('Truncated guarded frame.');const v=this.b.subarray(this.at,this.at+n);this.at+=n;return v;}
 field(max:number){const n=this.take(2).readUInt16BE();if(n>max)throw Error('Guarded field exceeds limit.');return this.take(n);}
 magic(s:string){if(!this.take(8).equals(Buffer.from(s)))throw Error('Wrong guarded frame purpose.');}
 end(){if(this.at!==this.b.length)throw Error('Unexpected guarded frame data.');}
}
function field(b:Buffer,max:number){if(b.length>max)throw Error('Guarded field exceeds limit.');const size=Buffer.alloc(2);size.writeUInt16BE(b.length);return Buffer.concat([size,b]);}
function text(v:string,max:number){const b=Buffer.from(v,'utf8');if(new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(b)!==v)throw Error('Lossy guarded text.');return field(b,max);}
const readText=(b:Buffer)=>new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(b);
function bounded(chunks:Buffer[],max:number){const b=Buffer.concat(chunks);if(b.length>max){b.fill(0);throw Error('Guarded frame exceeds limit.');}return b;}
export function encodeExpiringJupiterRequestFrame(input:unknown){
 const r=expiringJupiterSchema.parse(input),{guard,...plain}=r;
 const legacy=encodeJupiterRequestFrame({...plain,kind:'swap',version:4});
 return bounded([Buffer.from('DKJXPRQ1'),field(legacy,28672),Buffer.from(new PublicKey(guard.programId).toBytes()),Buffer.from(new PublicKey(guard.programData).toBytes()),Buffer.from(guard.sha256,'hex')],MAX_EXPIRING_JUPITER_REQUEST_FRAME);
}
export function decodeExpiringJupiterRequestFrame(frame:Buffer){
 const f=new Frame(frame,MAX_EXPIRING_JUPITER_REQUEST_FRAME);f.magic('DKJXPRQ1');const legacy=decodeJupiterRequestFrame(f.field(28672)),programId=new PublicKey(f.take(32)).toBase58(),programData=new PublicKey(f.take(32)).toBase58(),sha256=f.take(32).toString('hex');f.end();
 return expiringJupiterSchema.parse({...legacy,version:1,kind:'jupiter-expiring-swap',guard:{programId,programData,sha256,immutable:true}});
}
export function encodeExpiringJupiterSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid guarded signing command.');
 const chunks=[Buffer.from('DKJXPKY1'),field(encodeExpiringJupiterRequestFrame(request),MAX_EXPIRING_JUPITER_REQUEST_FRAME),field(encodeVaultFrame(vault),512),Buffer.from(fingerprint.slice(2),'hex'),text(password,1024)];
 try{return bounded(chunks,MAX_EXPIRING_JUPITER_SIGN_FRAME);}finally{chunks.forEach(v=>v.fill(0));}
}
export function decodeExpiringJupiterSigningFrame(frame:Buffer){
 const f=new Frame(frame,MAX_EXPIRING_JUPITER_SIGN_FRAME);f.magic('DKJXPKY1');const request=decodeExpiringJupiterRequestFrame(f.field(MAX_EXPIRING_JUPITER_REQUEST_FRAME)),vault=decodeVaultFrame(f.field(512)),fingerprint='0x'+f.take(32).toString('hex'),password=readText(f.field(1024));f.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
function signature(s:string){const b=Buffer.from(bs58.decode(s));if(b.length!==64||bs58.encode(b)!==s)throw Error('Invalid signature.');return b;}
export function encodeExpiringJupiterResponseFrame(input:unknown){
 const r=expiringJupiterResponseSchema.parse(input),raw=Buffer.from(r.rawSignedTransaction,'base64');if(raw.toString('base64')!==r.rawSignedTransaction||raw.length>1232)throw Error('Invalid guarded transaction encoding.');
 return bounded([Buffer.from('DKJXPRS1'),text(r.requestId,36),text(r.deviceId,36),Buffer.from(r.fingerprint.slice(2),'hex'),text(r.signedAt,64),field(raw,1232),signature(r.transactionHash),signature(r.approvalSignature)],MAX_EXPIRING_JUPITER_RESPONSE_FRAME);
}
export function decodeExpiringJupiterResponseFrame(frame:Buffer){
 const f=new Frame(frame,MAX_EXPIRING_JUPITER_RESPONSE_FRAME);f.magic('DKJXPRS1');const requestId=readText(f.field(36)),deviceId=readText(f.field(36)),fingerprint='0x'+f.take(32).toString('hex'),signedAt=readText(f.field(64)),rawSignedTransaction=f.field(1232).toString('base64'),transactionHash=bs58.encode(f.take(64)),approvalSignature=bs58.encode(f.take(64));f.end();return expiringJupiterResponseSchema.parse({version:1,kind:'jupiter-expiring-swap',network:'solana',requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,transactionHash,approvalSignature});
}
