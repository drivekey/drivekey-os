import {wethConversionSchema,wethConversionResponseSchema,type WethConversionRequest} from '../core/weth-conversion-protocol';
import {ETHEREUM_IDENTITIES} from '../core/ethereum-contract-identity';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_WETH_REQUEST_FRAME=4096,MAX_WETH_SIGN_FRAME=6144,MAX_WETH_RESPONSE_FRAME=4096;
class Writer {
 private chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 short(n:number){if(!Number.isInteger(n)||n<0||n>65535)throw Error('Invalid boundary length.');const b=Buffer.alloc(2);b.writeUInt16BE(n);this.chunks.push(b);}
 field(b:Uint8Array,max:number){if(b.length>max)throw Error('Boundary field exceeds limit.');this.short(b.length);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b)!==s)throw Error('Lossy boundary text.');this.field(b,max);}finally{b.fill(0);}}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Boundary frame exceeds limit.');}return b;}finally{for(const b of this.chunks)b.fill(0);}}
}
class Reader {
 private at=0;
 constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Boundary frame exceeds limit.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||this.at+n>this.b.length)throw Error('Truncated boundary frame.');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 short(){return this.bytes(2).readUInt16BE();}
 field(max:number){const n=this.short();if(n>max)throw Error('Boundary field exceeds limit.');return this.bytes(n);}
 text(max:number){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.field(max));}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s,'ascii')))throw Error('Wrong boundary purpose/version.');}
 version(){const v=this.bytes(1)[0];if(v!==1)throw Error('Unsupported native payment version.');return v;}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
export function encodeWethRequestFrame(input:unknown){
 const r=wethConversionSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKWETHR1'));w.bytes(Buffer.from([r.action==='wrap'?0:1]));
 for(const s of [r.requestId,r.deviceId])w.text(s,36);for(const s of [r.createdAt,r.expiresAt])w.text(s,64);for(const s of [r.from,r.recipient])w.text(s,42);
 w.text(r.amount,20);w.field(Buffer.from(r.unsignedTransaction.slice(2),'hex'),1023);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));return w.finish(MAX_WETH_REQUEST_FRAME);
}
export function decodeWethRequestFrame(frame:Buffer):WethConversionRequest{
 const r=new Reader(frame,MAX_WETH_REQUEST_FRAME);r.magic('DKWETHR1');const code=r.bytes(1)[0];if(code>1)throw Error('Invalid conversion action');
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(64),expiresAt=r.text(64),from=r.text(42),recipient=r.text(42),amount=r.text(20),unsignedTransaction='0x'+r.field(1023).toString('hex'),fingerprint=digest(r);r.end();
 return wethConversionSchema.parse({version:1,kind:'weth-conversion',action:code===0?'wrap':'unwrap',network:'ethereum',chainId:1,requestId,deviceId,createdAt,expiresAt,from,recipient,amount,contract:ETHEREUM_IDENTITIES.WETH.address,codeHash:ETHEREUM_IDENTITIES.WETH.codeHash,unsignedTransaction,fingerprint});
}
export function encodeWethSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid conversion command');
 const w=new Writer();w.bytes(Buffer.from('DKWETHK1'));w.field(encodeWethRequestFrame(request),MAX_WETH_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_WETH_SIGN_FRAME);
}
export function decodeWethSigningFrame(frame:Buffer){const r=new Reader(frame,MAX_WETH_SIGN_FRAME);r.magic('DKWETHK1');const request=decodeWethRequestFrame(r.field(MAX_WETH_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit');return {request,vault,fingerprint,password};}
export function encodeWethResponseFrame(input:unknown){
 const s=wethConversionResponseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKWETHS1'));w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),2047);w.bytes(Buffer.from(s.approvalSignature.slice(2),'hex'));w.bytes(Buffer.from(s.transactionHash.slice(2),'hex'));return w.finish(MAX_WETH_RESPONSE_FRAME);
}
export function decodeWethResponseFrame(frame:Buffer){const r=new Reader(frame,MAX_WETH_RESPONSE_FRAME);r.magic('DKWETHS1');const requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64),rawSignedTransaction='0x'+r.field(2047).toString('hex'),approvalSignature='0x'+r.bytes(65).toString('hex'),transactionHash=digest(r);r.end();return wethConversionResponseSchema.parse({version:1,kind:'weth-conversion-response',requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,transactionHash});}

