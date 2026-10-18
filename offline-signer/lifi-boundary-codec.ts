// Internal bounded transport only. External LI.FI v9 request/response formats stay unchanged.
// Preserve all fingerprint/AAD-covered strings; never normalize UUID or address case.
import {lifiRequestSchema,lifiResponseSchema,type LifiRequest} from '../core/lifi-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_LIFI_REQUEST_FRAME=24576, MAX_LIFI_SIGN_FRAME=32768, MAX_LIFI_RESPONSE_FRAME=12288;
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
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
export function encodeLifiRequestFrame(input:unknown){
 const r=lifiRequestSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKLIFIR9'));
 for(const s of [r.requestId,r.deviceId])w.text(s,36);
 for(const s of [r.createdAt,r.expiresAt])w.text(s,4096);
 w.text(r.from,128);
 for(const s of [r.amount,r.minimumOutput,r.quotedOutput,r.providerFee])w.text(s,39);
 w.short(r.slippageBps);w.text(r.quoteId,800);w.bytes(Buffer.from(r.identityDigest.slice(2),'hex'));
 w.field(Buffer.from(r.unsignedTransaction.slice(2),'hex'),9999);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));
 return w.finish(MAX_LIFI_REQUEST_FRAME);
}
export function decodeLifiRequestFrame(frame:Buffer):LifiRequest{
 const r=new Reader(frame,MAX_LIFI_REQUEST_FRAME);r.magic('DKLIFIR9');
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.text(128);
 const amount=r.text(39),minimumOutput=r.text(39),quotedOutput=r.text(39),providerFee=r.text(39),slippageBps=r.short(),quoteId=r.text(800),identityDigest=digest(r);
 const unsignedTransaction='0x'+r.field(9999).toString('hex'),fingerprint=digest(r);r.end();
 return lifiRequestSchema.parse({version:9,kind:'lifi-native-swap',network:'ethereum',chainId:1,requestId,deviceId,createdAt,expiresAt,from,amount,minimumOutput,quotedOutput,providerFee,slippageBps,quoteId,identityDigest,unsignedTransaction,fingerprint});
}
export function encodeLifiSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid LI.FI signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKLIFIK9'));w.field(encodeLifiRequestFrame(request),MAX_LIFI_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);
 w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_LIFI_SIGN_FRAME);
}
export function decodeLifiSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_LIFI_SIGN_FRAME);r.magic('DKLIFIK9');const request=decodeLifiRequestFrame(r.field(MAX_LIFI_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512));
 const fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
export function encodeLifiResponseFrame(input:unknown){
 const s=lifiResponseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKLIFIS9'));
 w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);
 w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),9999);w.bytes(Buffer.from(s.approvalSignature.slice(2),'hex'));w.bytes(Buffer.from(s.transactionHash.slice(2),'hex'));
 return w.finish(MAX_LIFI_RESPONSE_FRAME);
}
export function decodeLifiResponseFrame(frame:Buffer){
 const r=new Reader(frame,MAX_LIFI_RESPONSE_FRAME);r.magic('DKLIFIS9');const requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64);
 const rawSignedTransaction='0x'+r.field(9999).toString('hex'),approvalSignature='0x'+r.bytes(65).toString('hex'),transactionHash=digest(r);r.end();
 return lifiResponseSchema.parse({version:9,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,transactionHash});
}
export function decodeTradeRouteFrame(frame:Buffer){
 if(frame.length!==9||!frame.subarray(0,8).equals(Buffer.from('DKROUTE1'))||frame[8]>1)throw Error('Invalid trade routing reply.');return frame[8]===1;
}
