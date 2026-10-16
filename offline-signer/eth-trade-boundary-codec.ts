// Private typed transport. Existing v4/v7 token payment/approval/swap files are unchanged.
import {tradeSchema,tradeResponseSchema,type TradeRequest} from '../core/trade-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_ETH_TRADE_REQUEST_FRAME=16384,MAX_ETH_TRADE_SIGN_FRAME=18432,MAX_ETH_TRADE_RESPONSE_FRAME=6144;
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
 version(){const v=this.bytes(1)[0];if(v!==4&&v!==7)throw Error('Unsupported Ethereum trade version.');return v;}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
// Broad classification sends malformed v4/v7 claims to strict rejection.
// Solana v4 has its own earlier route; no JSON or legacy signer fallback exists.
export function isEthTradeShape(value:unknown):boolean{
 return !!value&&typeof value==='object'&&'version' in value&&(value.version===4||value.version===7);
}
const kinds=['payment','approval','swap'] as const,tokens=['WETH','USDC'] as const,names=['WETH','USDC','Router','Quoter','Factory','Pool500','Pool3000'] as const;
function choice<T>(values:readonly T[],n:number):T{if(n>=values.length)throw Error('Unsupported boundary choice.');return values[n];}
export function encodeEthTradeRequestFrame(input:unknown){
 const r=tradeSchema.parse(input),w=new Writer();
 if(r.tokenIn==='ETH')throw Error('Native ETH uses its separate signing boundary.');
 w.bytes(Buffer.from('DKETRDR1'));w.bytes(Buffer.from([r.version]));
 for(const s of [r.requestId,r.deviceId])w.text(s,36);
 for(const s of [r.createdAt,r.expiresAt])w.text(s,4096);
 for(const s of [r.from,r.recipient])w.text(s,128);
 w.bytes(Buffer.from([kinds.indexOf(r.kind),tokens.indexOf(r.tokenIn),r.tokenOut===null?2:tokens.indexOf(r.tokenOut)]));
 for(const s of [r.amount,r.minimumOutput,r.quotedOutput])w.text(s,78);
 w.short(r.slippageBps);w.short(r.poolFee);w.text(r.unsignedTransaction,4096);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));
 if(r.version===7){w.bytes(Buffer.from([r.contractIdentities.length]));for(const p of r.contractIdentities){
  w.bytes(Buffer.from([names.indexOf(p.name)]));w.text(p.address,128);w.bytes(Buffer.from(p.codeHash.slice(2),'hex'));
  const flags=(p.implementationSlot!==undefined?1:0)|(p.implementation!==undefined?2:0)|(p.implementationCodeHash!==undefined?4:0);w.bytes(Buffer.from([flags]));
  if(p.implementationSlot!==undefined)w.bytes(Buffer.from(p.implementationSlot.slice(2),'hex'));if(p.implementation!==undefined)w.text(p.implementation,128);if(p.implementationCodeHash!==undefined)w.bytes(Buffer.from(p.implementationCodeHash.slice(2),'hex'));
 }}
 return w.finish(MAX_ETH_TRADE_REQUEST_FRAME);
}
export function decodeEthTradeRequestFrame(frame:Buffer):TradeRequest{
 const r=new Reader(frame,MAX_ETH_TRADE_REQUEST_FRAME);r.magic('DKETRDR1');const version=r.version();
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.text(128),recipient=r.text(128);
 const kind=choice(kinds,r.bytes(1)[0]),tokenIn=choice(tokens,r.bytes(1)[0]),out=r.bytes(1)[0],tokenOut=out===2?null:choice(tokens,out);
 const amount=r.text(78),minimumOutput=r.text(78),quotedOutput=r.text(78),slippageBps=r.short(),poolFee=r.short(),unsignedTransaction=r.text(4096),fingerprint=digest(r);
 const contractIdentities=[];if(version===7){const count=r.bytes(1)[0];if(count>7)throw Error('Too many contract identities.');for(let i=0;i<count;i++){
  const name=choice(names,r.bytes(1)[0]),address=r.text(128),codeHash=digest(r),flags=r.bytes(1)[0];if(flags>7)throw Error('Unsupported identity flags.');
  contractIdentities.push({name,address,codeHash,...(flags&1?{implementationSlot:digest(r)}:{}),...(flags&2?{implementation:r.text(128)}:{}),...(flags&4?{implementationCodeHash:digest(r)}:{})});
 }}r.end();
 return tradeSchema.parse({version,network:'ethereum',chainId:1,kind,requestId,deviceId,createdAt,expiresAt,from,recipient,tokenIn,tokenOut,amount,minimumOutput,quotedOutput,slippageBps,poolFee,unsignedTransaction,...(version===7?{contractIdentities}:{}),fingerprint});
}
export function encodeEthTradeSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid native signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKETRDK1'));w.field(encodeEthTradeRequestFrame(request),MAX_ETH_TRADE_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_ETH_TRADE_SIGN_FRAME);
}
export function decodeEthTradeSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ETH_TRADE_SIGN_FRAME);r.magic('DKETRDK1');const request=decodeEthTradeRequestFrame(r.field(MAX_ETH_TRADE_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
export function encodeEthTradeResponseFrame(input:unknown){
 const s=tradeResponseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKETRDS1'));w.bytes(Buffer.from([s.version]));
 w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);
 if(!/^0x(?:[0-9a-f]{2})+$/.test(s.rawSignedTransaction)||!/^0x[0-9a-fA-F]{130}$/.test(s.approvalSignature))throw Error('Invalid native response bytes.');
 w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),4095);w.bytes(Buffer.from(s.approvalSignature.slice(2),'hex'));w.bytes(Buffer.from(s.transactionHash.slice(2),'hex'));return w.finish(MAX_ETH_TRADE_RESPONSE_FRAME);
}
export function decodeEthTradeResponseFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ETH_TRADE_RESPONSE_FRAME);r.magic('DKETRDS1');const version=r.version(),requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64),rawSignedTransaction='0x'+r.field(4095).toString('hex'),approvalSignature='0x'+r.bytes(65).toString('hex'),transactionHash=digest(r);r.end();return tradeResponseSchema.parse({version,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,transactionHash});
}
export function decodeEthTradeRouteFrame(frame:Buffer){
 if(frame.length!==9||!frame.subarray(0,8).equals(Buffer.from('DKETRDT1'))||frame[8]>1)throw Error('Invalid Ethereum trade routing reply.');return frame[8]===1;
}
