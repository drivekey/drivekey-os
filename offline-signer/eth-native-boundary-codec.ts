// Internal bounded transport only. Existing v4/v7 native-payment JSON stays unchanged.
import {tradeSchema,tradeResponseSchema,type TradeRequest} from '../core/trade-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_ETH_NATIVE_REQUEST_FRAME=12288,MAX_ETH_NATIVE_SIGN_FRAME=16384,MAX_ETH_NATIVE_RESPONSE_FRAME=6144;
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
 version(){const v=this.bytes(1)[0];if(v!==4&&v!==7)throw Error('Unsupported native payment version.');return v;}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
// Deliberately classifies malformed network/chain claims into the rejecting
// isolated parser rather than allowing a selected native payment to fall back.
export function isEthNativeTradeShape(value:unknown):boolean{
 return !!value&&typeof value==='object'&&'version' in value&&(value.version===4||value.version===7)&&'kind' in value&&value.kind==='payment'&&'tokenIn' in value&&value.tokenIn==='ETH';
}
export function encodeEthNativeRequestFrame(input:unknown){
 const r=tradeSchema.parse(input),w=new Writer();
 if(r.kind!=='payment'||r.tokenIn!=='ETH'||r.tokenOut!==null||r.minimumOutput!=='0'||r.quotedOutput!=='0'||r.slippageBps!==0||r.poolFee!==500||(r.version===7&&r.contractIdentities.length))throw Error('Unsupported native payment shape.');
 w.bytes(Buffer.from('DKENATR1'));w.bytes(Buffer.from([r.version]));
 for(const s of [r.requestId,r.deviceId])w.text(s,36);
 for(const s of [r.createdAt,r.expiresAt])w.text(s,4096);
 for(const s of [r.from,r.recipient])w.text(s,128);
 w.text(r.amount,39);w.field(Buffer.from(r.unsignedTransaction.slice(2),'hex'),2047);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));
 return w.finish(MAX_ETH_NATIVE_REQUEST_FRAME);
}
export function decodeEthNativeRequestFrame(frame:Buffer):TradeRequest{
 const r=new Reader(frame,MAX_ETH_NATIVE_REQUEST_FRAME);r.magic('DKENATR1');const version=r.version();
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.text(128),recipient=r.text(128),amount=r.text(39),unsignedTransaction='0x'+r.field(2047).toString('hex'),fingerprint=digest(r);r.end();
 return tradeSchema.parse({version,network:'ethereum',chainId:1,kind:'payment',requestId,deviceId,createdAt,expiresAt,from,recipient,tokenIn:'ETH',tokenOut:null,amount,minimumOutput:'0',quotedOutput:'0',slippageBps:0,poolFee:500,unsignedTransaction,...(version===7?{contractIdentities:[]}:{}),fingerprint});
}
export function encodeEthNativeSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid native signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKENATK1'));w.field(encodeEthNativeRequestFrame(request),MAX_ETH_NATIVE_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_ETH_NATIVE_SIGN_FRAME);
}
export function decodeEthNativeSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ETH_NATIVE_SIGN_FRAME);r.magic('DKENATK1');const request=decodeEthNativeRequestFrame(r.field(MAX_ETH_NATIVE_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
export function encodeEthNativeResponseFrame(input:unknown){
 const s=tradeResponseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKENATS1'));w.bytes(Buffer.from([s.version]));
 w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);
 if(!/^0x(?:[0-9a-f]{2})+$/.test(s.rawSignedTransaction)||!/^0x[0-9a-fA-F]{130}$/.test(s.approvalSignature))throw Error('Invalid native response bytes.');
 w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),4095);w.bytes(Buffer.from(s.approvalSignature.slice(2),'hex'));w.bytes(Buffer.from(s.transactionHash.slice(2),'hex'));return w.finish(MAX_ETH_NATIVE_RESPONSE_FRAME);
}
export function decodeEthNativeResponseFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ETH_NATIVE_RESPONSE_FRAME);r.magic('DKENATS1');const version=r.version(),requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64),rawSignedTransaction='0x'+r.field(4095).toString('hex'),approvalSignature='0x'+r.bytes(65).toString('hex'),transactionHash=digest(r);r.end();return tradeResponseSchema.parse({version,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,transactionHash});
}
export function decodeEthNativeRouteFrame(frame:Buffer){
 if(frame.length!==9||!frame.subarray(0,8).equals(Buffer.from('DKENATT1'))||frame[8]>1)throw Error('Invalid native payment routing reply.');return frame[8]===1;
}
