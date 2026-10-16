// Internal bounded typed transport; external Robinhood v2 files stay unchanged.
import {requestSchema,responseSchema,type TransferRequest} from '../core/protocol';
import {validateVault} from './vault-format';
export const MAX_ROBINHOOD_REQUEST_FRAME=12288,MAX_ROBINHOOD_VAULT_FRAME=4608,MAX_ROBINHOOD_SIGN_FRAME=18432,MAX_ROBINHOOD_RESPONSE_FRAME=3072;
class Writer {
 private chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 field(b:Uint8Array,max:number){if(b.length>max)throw Error('Boundary field exceeds limit.');const n=Buffer.alloc(2);n.writeUInt16BE(b.length);this.chunks.push(n,Buffer.from(b));}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b)!==s)throw Error('Lossy boundary text.');this.field(b,max);}finally{b.fill(0);}}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Boundary frame exceeds limit.');}return b;}finally{for(const b of this.chunks)b.fill(0);}}
}
class Reader {
 private at=0;
 constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Boundary frame exceeds limit.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||this.at+n>this.b.length)throw Error('Truncated boundary frame.');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 field(max:number){const n=this.bytes(2).readUInt16BE();if(n>max)throw Error('Boundary field exceeds limit.');return this.bytes(n);}
 text(max:number){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.field(max));}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s)))throw Error('Wrong boundary purpose/version.');}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
export function encodeRobinhoodRequestFrame(input:unknown){
 const r=requestSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKRHREQ2'));
 for(const s of [r.requestId,r.deviceId])w.text(s,36);
 for(const s of [r.createdAt,r.expiresAt])w.text(s,4096);
 for(const s of [r.from,r.to])w.text(s,42);
 for(const s of [r.value,r.nonce,r.gasLimit,r.maxFeePerGas,r.maxPriorityFeePerGas])w.text(s,24);
 // Preserve original spelling: canonical byte checks happen independently in the key worker.
 w.text(r.unsignedTransaction,4096);w.text(r.fingerprint,66);return w.finish(MAX_ROBINHOOD_REQUEST_FRAME);
}
export function decodeRobinhoodRequestFrame(frame:Buffer):TransferRequest{
 const r=new Reader(frame,MAX_ROBINHOOD_REQUEST_FRAME);r.magic('DKRHREQ2');
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(4096),expiresAt=r.text(4096),from=r.text(42),to=r.text(42);
 const value=r.text(24),nonce=r.text(24),gasLimit=r.text(24),maxFeePerGas=r.text(24),maxPriorityFeePerGas=r.text(24),unsignedTransaction=r.text(4096),fingerprint=r.text(66);r.end();
 return requestSchema.parse({version:2,chainId:4663,type:2,requestId,deviceId,createdAt,expiresAt,from,to,value,nonce,gasLimit,maxFeePerGas,maxPriorityFeePerGas,unsignedTransaction,fingerprint});
}
export function encodeRobinhoodVaultFrame(input:unknown){
 const v=validateVault(input),w=new Writer(),c=v.keystore.Crypto;w.bytes(Buffer.from('DKRHVAU2'));
 w.text(v.public.deviceId,36);w.text(v.public.createdAt,4096);w.text(v.public.address,42);w.text(v.keystore.id,36);
 for(const s of [v.keystore.address,c.cipherparams.iv,c.ciphertext,c.kdfparams.salt,c.mac])w.text(s,64);
 return w.finish(MAX_ROBINHOOD_VAULT_FRAME);
}
export function decodeRobinhoodVaultFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ROBINHOOD_VAULT_FRAME);r.magic('DKRHVAU2');
 const deviceId=r.text(36),createdAt=r.text(4096),publicAddress=r.text(42),id=r.text(36),address=r.text(64),iv=r.text(64),ciphertext=r.text(64),salt=r.text(64),mac=r.text(64);r.end();
 return validateVault({version:2,kind:'drivekey-offline-vault',public:{version:2,chainId:4663,deviceId,createdAt,address:publicAddress},keystore:{version:3,id,address,Crypto:{cipher:'aes-128-ctr',cipherparams:{iv},ciphertext,kdf:'scrypt',kdfparams:{dklen:32,n:131072,r:8,p:1,salt},mac}}});
}
export function encodeRobinhoodSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-fA-F]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid Robinhood signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKRHSIG2'));w.field(encodeRobinhoodRequestFrame(request),MAX_ROBINHOOD_REQUEST_FRAME);w.field(encodeRobinhoodVaultFrame(vault),MAX_ROBINHOOD_VAULT_FRAME);w.text(fingerprint,66);w.text(password,1024);return w.finish(MAX_ROBINHOOD_SIGN_FRAME);
}
export function decodeRobinhoodSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ROBINHOOD_SIGN_FRAME);r.magic('DKRHSIG2');const request=decodeRobinhoodRequestFrame(r.field(MAX_ROBINHOOD_REQUEST_FRAME)),vault=decodeRobinhoodVaultFrame(r.field(MAX_ROBINHOOD_VAULT_FRAME)),fingerprint=r.text(66),password=r.text(1024);r.end();
 if(!/^0x[0-9a-fA-F]{64}$/.test(fingerprint)||password.length>256)throw Error('Invalid Robinhood signing command.');return {request,vault,fingerprint,password};
}
export function encodeRobinhoodResponseFrame(input:unknown){
 const s=responseSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKRHOUT2'));w.text(s.requestId,36);w.text(s.deviceId,36);w.text(s.fingerprint,66);w.text(s.signedAt,64);
 w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),2047);w.text(s.approvalSignature,132);w.text(s.signer,42);w.text(s.transactionHash,66);return w.finish(MAX_ROBINHOOD_RESPONSE_FRAME);
}
export function decodeRobinhoodResponseFrame(frame:Buffer){
 const r=new Reader(frame,MAX_ROBINHOOD_RESPONSE_FRAME);r.magic('DKRHOUT2');const requestId=r.text(36),deviceId=r.text(36),fingerprint=r.text(66),signedAt=r.text(64),rawSignedTransaction='0x'+r.field(2047).toString('hex'),approvalSignature=r.text(132),signer=r.text(42),transactionHash=r.text(66);r.end();
 return responseSchema.parse({version:2,requestId,deviceId,fingerprint,signedAt,rawSignedTransaction,approvalSignature,signer,transactionHash});
}
