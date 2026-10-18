// Internal typed transport. Existing v3/v6 public files and approval domains are unchanged.
import {multiRequestSchema,multiResponseSchema,type MultiRequest} from '../core/multi-protocol';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_MULTI_REQUEST_FRAME=12288,MAX_MULTI_SIGN_FRAME=16384,MAX_MULTI_RESPONSE_FRAME=6144;
class Writer {
 private chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 byte(n:number){if(!Number.isInteger(n)||n<0||n>255)throw Error('Invalid boundary byte.');this.bytes(Buffer.from([n]));}
 field(b:Uint8Array,max:number){if(b.length>max||b.length>65535)throw Error('Boundary field exceeds limit.');const n=Buffer.alloc(2);n.writeUInt16BE(b.length);this.chunks.push(n);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b)!==s)throw Error('Lossy boundary text.');this.field(b,max);}finally{b.fill(0);}}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Boundary frame exceeds limit.');}return b;}finally{for(const b of this.chunks)b.fill(0);}}
}
class Reader {
 private at=0;
 constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Boundary frame exceeds limit.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||this.at+n>this.b.length)throw Error('Truncated boundary frame.');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 byte(){return this.bytes(1)[0];}
 field(max:number){const n=this.bytes(2).readUInt16BE();if(n>max)throw Error('Boundary field exceeds limit.');return this.bytes(n);}
 text(max:number){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.field(max));}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s,'ascii')))throw Error('Wrong boundary purpose/version.');}
 version(){const v=this.byte();if(v!==3&&v!==6)throw Error('Unsupported multi version.');return v;}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
const digest=(r:Reader)=>'0x'+r.bytes(32).toString('hex');
export function encodeMultiRequestFrame(input:unknown){
 const r=multiRequestSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKMULTI1'));w.byte(r.version);w.byte(r.network==='robinhood'?1:2);
 w.text(r.requestId,36);w.text(r.deviceId,36);w.text(r.createdAt,4096);w.text(r.expiresAt,4096);
 w.text(r.from,44);w.text(r.recipient,44);w.text(r.token,44);w.text(r.amount,78);w.byte(r.decimals);w.text(r.unsignedTransaction,4096);w.bytes(Buffer.from(r.fingerprint.slice(2),'hex'));
 if(r.network==='robinhood'){
  w.bytes(Buffer.from(r.codeHash.slice(2),'hex'));
  if(r.version===6){w.text(r.implementation,42);w.bytes(Buffer.from(r.implementationCodeHash.slice(2),'hex'));}
 }else{
  w.byte(r.standard==='native'?1:2);w.text(r.genesisHash,44);w.text(r.nonceAccount,44);w.text(r.nonceValue,44);w.text(r.maximumFee,78);w.text(r.accountRent,78);w.byte(r.createRecipientAccount?1:0);
 }
 return w.finish(MAX_MULTI_REQUEST_FRAME);
}
export function decodeMultiRequestFrame(frame:Buffer):MultiRequest{
 const r=new Reader(frame,MAX_MULTI_REQUEST_FRAME);r.magic('DKMULTI1');const version=r.version(),network=r.byte();
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.text(44),recipient=r.text(44),token=r.text(44),amount=r.text(78),decimals=r.byte(),unsignedTransaction=r.text(4096),fingerprint=digest(r);
 const common={version,requestId,deviceId,createdAt,expiresAt,from,recipient,token,amount,decimals,unsignedTransaction,fingerprint};let value:unknown;
 if(network===1){const codeHash=digest(r);value={...common,network:'robinhood',chainId:4663,standard:'erc20',codeHash,...(version===6?{implementation:r.text(42),implementationCodeHash:digest(r)}:{})};}
 else if(network===2){const standard=r.byte();if(standard!==1&&standard!==2)throw Error('Unsupported Solana standard.');const genesisHash=r.text(44),nonceAccount=r.text(44),nonceValue=r.text(44),maximumFee=r.text(78),accountRent=r.text(78),create=r.byte();if(create>1)throw Error('Invalid account-creation flag.');value={...common,network:'solana',standard:standard===1?'native':'spl',genesisHash,nonceAccount,nonceValue,maximumFee,accountRent,createRecipientAccount:create===1};}
 else throw Error('Unsupported transfer network.');
 r.end();return multiRequestSchema.parse(value);
}
export function encodeMultiSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid multi signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKMULTK1'));w.field(encodeMultiRequestFrame(request),MAX_MULTI_REQUEST_FRAME);w.field(encodeVaultFrame(vault),512);w.bytes(Buffer.from(fingerprint.slice(2),'hex'));w.text(password,1024);return w.finish(MAX_MULTI_SIGN_FRAME);
}
export function decodeMultiSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_MULTI_SIGN_FRAME);r.magic('DKMULTK1');const request=decodeMultiRequestFrame(r.field(MAX_MULTI_REQUEST_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=digest(r),password=r.text(1024);r.end();if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
export function encodeMultiResponseFrame(input:unknown){
 const s=multiResponseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKMULTS1'));w.byte(s.version);w.text(s.requestId,36);w.text(s.deviceId,36);w.bytes(Buffer.from(s.fingerprint.slice(2),'hex'));w.text(s.signedAt,64);w.text(s.rawSignedTransaction,4096);w.text(s.approvalSignature,132);w.text(s.transactionHash,90);return w.finish(MAX_MULTI_RESPONSE_FRAME);
}
export function decodeMultiResponseFrame(frame:Buffer){
 const r=new Reader(frame,MAX_MULTI_RESPONSE_FRAME);r.magic('DKMULTS1');const version=r.version(),requestId=r.text(36),deviceId=r.text(36),fingerprint=digest(r),signedAt=r.text(64),rawSignedTransaction=r.text(4096),approvalSignature=r.text(132),transactionHash=r.text(90);r.end();return multiResponseSchema.parse({version,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,transactionHash});
}
