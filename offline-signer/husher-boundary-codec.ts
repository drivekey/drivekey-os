// Internal transport only; the external provider-bound v8 format is unchanged.
// Every nonconstant fingerprint/AAD-covered string survives byte-for-byte.
import {husherDepositSchema,husherDepositResponseSchema,type HusherDepositRequest} from '../core/husher-deposit-protocol';
import {ETH_TOKENS} from '../core/trade-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_HUSHER_REQUEST_FRAME=24576,MAX_HUSHER_SIGN_FRAME=32768,MAX_HUSHER_RESPONSE_FRAME=6144;
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
export function encodeHusherRequestFrame(input:unknown){
 const r=husherDepositSchema.parse(input),p=r.payment,t=r.terms,w=new Writer();
 // Omitted constants must match; never silently normalize another trade into ETH payment.
 if(p.kind!=='payment'||p.tokenIn!=='ETH'||p.tokenOut!==null||p.minimumOutput!=='0'||p.quotedOutput!=='0'||p.slippageBps!==0||p.poolFee!==500||p.contractIdentities.length)throw Error('Unsupported Husher payment shape.');
 w.bytes(Buffer.from('DKHUSHR8'));
 for(const s of [p.requestId,p.deviceId])w.text(s,36);
 for(const s of [p.createdAt,p.expiresAt])w.text(s,4096);
 for(const s of [p.from,p.recipient])w.text(s,128);
 w.text(p.amount,39);w.field(Buffer.from(p.unsignedTransaction.slice(2),'hex'),2047);w.bytes(Buffer.from(p.fingerprint.slice(2),'hex'));
 w.text(t.orderId,64);w.text(t.externalUserId,45);
 for(const s of [t.depositAddress,t.payoutAddress,t.refundAddress])w.text(s,128);
 for(const s of [t.sendBaseUnits,t.exactReceiveBaseUnits,t.providerFeeBaseUnits,t.withdrawalFeeBaseUnits,t.maximumProviderFeeBaseUnits])w.text(s,39);
 for(const s of [t.depositDeadline,t.rateLockExpiresAt,t.orderExpiresAt])w.text(s,4096);
 w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));return w.finish(MAX_HUSHER_REQUEST_FRAME);
}
export function decodeHusherRequestFrame(frame:Buffer):HusherDepositRequest{
 const r=new Reader(frame,MAX_HUSHER_REQUEST_FRAME);r.magic('DKHUSHR8');
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.text(128),recipient=r.text(128),amount=r.text(39);
 const unsignedTransaction='0x'+r.field(2047).toString('hex'),paymentFingerprint=digest(r),orderId=r.text(64),externalUserId=r.text(45);
 const depositAddress=r.text(128),payoutAddress=r.text(128),refundAddress=r.text(128);
 const sendBaseUnits=r.text(39),exactReceiveBaseUnits=r.text(39),providerFeeBaseUnits=r.text(39),withdrawalFeeBaseUnits=r.text(39),maximumProviderFeeBaseUnits=r.text(39);
 const depositDeadline=r.text(4096),rateLockExpiresAt=r.text(4096),orderExpiresAt=r.text(4096),fingerprint=digest(r);r.end();
 return husherDepositSchema.parse({version:8,kind:'provider-deposit',payment:{version:7,network:'ethereum',chainId:1,kind:'payment',requestId,deviceId,createdAt,expiresAt,from,recipient,tokenIn:'ETH',tokenOut:null,amount,minimumOutput:'0',quotedOutput:'0',slippageBps:0,poolFee:500,unsignedTransaction,contractIdentities:[],fingerprint:paymentFingerprint},
  terms:{provider:'husher',orderType:'normal',fixedRate:true,privacy:false,network:'ethereum',chainId:1,sendAsset:'ETH',receiveAsset:'USDC',receiveContract:ETH_TOKENS.USDC.address,receiveDecimals:6,orderId,externalUserId,depositAddress,payoutAddress,refundAddress,sendBaseUnits,exactReceiveBaseUnits,providerFeeBaseUnits,withdrawalFeeBaseUnits,maximumProviderFeeBaseUnits,depositDeadline,rateLockExpiresAt,orderExpiresAt},fingerprint});
}
export function encodeHusherSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid Husher signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKHUSHK8'));w.field(encodeHusherRequestFrame(request),MAX_HUSHER_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);
 w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_HUSHER_SIGN_FRAME);
}
export function decodeHusherSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_HUSHER_SIGN_FRAME);r.magic('DKHUSHK8');const request=decodeHusherRequestFrame(r.field(MAX_HUSHER_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512));
 const fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
export function encodeHusherResponseFrame(input:unknown){
 const s=husherDepositResponseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKHUSHS8'));
 w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);
 if(!/^0x(?:[0-9a-f]{2})+$/.test(s.rawSignedTransaction)||!/^0x[0-9a-fA-F]{130}$/.test(s.approvalSignature))throw Error('Invalid Husher response bytes.');
 w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),4095);w.bytes(Buffer.from(s.approvalSignature.slice(2),'hex'));w.bytes(Buffer.from(s.transactionHash.slice(2),'hex'));
 return w.finish(MAX_HUSHER_RESPONSE_FRAME);
}
export function decodeHusherResponseFrame(frame:Buffer){
 const r=new Reader(frame,MAX_HUSHER_RESPONSE_FRAME);r.magic('DKHUSHS8');const requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64);
 const rawSignedTransaction='0x'+r.field(4095).toString('hex'),approvalSignature='0x'+r.bytes(65).toString('hex'),transactionHash=digest(r);r.end();
 return husherDepositResponseSchema.parse({version:8,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,transactionHash});
}
export function decodeHusherRouteFrame(frame:Buffer){
 if(frame.length!==9||!frame.subarray(0,8).equals(Buffer.from('DKHUSHT8'))||frame[8]>1)throw Error('Invalid Husher routing reply.');return frame[8]===1;
}
