// Fixed typed binary transport. Raw media JSON never enters the key process.
import {getAddress} from 'ethers';
import {savingsTransactionRequestSchema,savingsTransactionResponseSchema,savingsTransactionFlags,type SavingsTransactionRequest} from '../core/savings-transaction';
import {encodeSavingsExpectationFrame,decodeSavingsExpectationFrame,encodeSavingsActionRequestFrame,decodeSavingsActionRequestFrame} from './savings-action-codec';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export const MAX_SAVINGS_TRANSACTION_FRAME=16000,MAX_SAVINGS_TRANSACTION_SIGN_FRAME=18000,MAX_SAVINGS_TRANSACTION_RESPONSE_FRAME=14500;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
class W{
 chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 byte(n:number){this.bytes(Buffer.from([n]));}
 field(b:Uint8Array,max:number){if(b.length>max||b.length>65535)throw Error('Savings field too large.');const n=Buffer.alloc(2);n.writeUInt16BE(b.length);this.bytes(n);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(decoder.decode(b)!==s)throw Error('Invalid boundary text.');this.field(b,max);}finally{b.fill(0);}}
 hash(s:string){this.bytes(Buffer.from(s.slice(2),'hex'));}
 address(s:string){this.hash(s);}
 uint(s:string){this.bytes(Buffer.from(BigInt(s).toString(16).padStart(64,'0'),'hex'));}
 counter(n:number){const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));this.bytes(b);}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Savings frame too large.');}return b;}finally{this.chunks.forEach(b=>b.fill(0));}}
}
class R{
 at=0;
 constructor(readonly b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Invalid savings frame.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||n>this.b.length-this.at)throw Error('Truncated savings frame.');const v=this.b.subarray(this.at,this.at+n);this.at+=n;return v;}
 byte(){return this.bytes(1)[0];}
 field(max:number){const n=this.bytes(2).readUInt16BE();if(n>max)throw Error('Savings field too large.');return this.bytes(n);}
 text(max:number){return decoder.decode(this.field(max));}
 hash(){return '0x'+this.bytes(32).toString('hex');}
 address(){return getAddress('0x'+this.bytes(20).toString('hex'));}
 uint(){return BigInt('0x'+this.bytes(32).toString('hex')).toString();}
 counter(){const n=this.bytes(8).readBigUInt64BE();if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Unsafe counter.');return Number(n);}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s)))throw Error('Wrong savings transaction boundary.');}
 end(){if(this.at!==this.b.length)throw Error('Trailing savings bytes.');}
}
export function encodeSavingsTransactionFrame(input:unknown){
 const r=savingsTransactionRequestSchema.parse(input),w=new W();w.bytes(Buffer.from('DKSTREQ1'));
 w.text(r.requestId,36);w.text(r.deviceId,36);w.text(r.createdAt,64);w.text(r.expiresAt,64);w.address(r.gasPayer);
 w.counter(r.gas.nonce);w.uint(r.gas.gasLimit);w.uint(r.gas.maxFeePerGas);w.uint(r.gas.maxPriorityFeePerGas);
 const o=r.operation;w.byte(o.kind==='deploy'?0:1);
 if(o.kind==='deploy'){
  // Duplicate gas/deployer fields must agree before canonical binary compression.
  const i=o.intent;if(i.deployer!==r.gasPayer||i.nonce!==r.gas.nonce||i.gasLimit!==r.gas.gasLimit||i.maxFeePerGas!==r.gas.maxFeePerGas||i.maxPriorityFeePerGas!==r.gas.maxPriorityFeePerGas)throw Error('Inconsistent deployment gas envelope.');
  w.address(i.expectedVault);w.byte(i.configuration.preset);w.byte(i.configuration.signers.length);i.configuration.signers.forEach(s=>w.address(s));
 }else{
  w.field(encodeSavingsExpectationFrame(o.expectation),160);w.field(encodeSavingsActionRequestFrame(o.request),512);
  w.hash(o.collection.workflowFingerprint);w.byte(o.collection.authorizations.length);
  for(const a of o.collection.authorizations){w.address(a.vault);w.address(a.signer);w.hash(a.fingerprint);w.hash(a.expectationFingerprint);w.hash(a.authorizationDigest);w.hash(a.signature);}
 }
 w.field(Buffer.from(r.unsignedTransaction.slice(2),'hex'),14000);w.hash(r.fingerprint);return w.finish(MAX_SAVINGS_TRANSACTION_FRAME);
}
export function decodeSavingsTransactionFrame(frame:Buffer):SavingsTransactionRequest{
 const r=new R(frame,MAX_SAVINGS_TRANSACTION_FRAME);r.magic('DKSTREQ1');
 const requestId=r.text(36),deviceId=r.text(36),createdAt=r.text(64),expiresAt=r.text(64),gasPayer=r.address();
 const gas={nonce:r.counter(),gasLimit:r.uint(),maxFeePerGas:r.uint(),maxPriorityFeePerGas:r.uint()};
 const tag=r.byte();let operation:unknown;
 if(tag===0){
  const expectedVault=r.address(),preset=r.byte(),count=r.byte();if(preset>1||count!==(preset===0?1:3))throw Error('Invalid signer configuration.');
  const signers=Array.from({length:count},()=>r.address());
  operation={kind:'deploy',intent:{kind:'drivekey-savings-enrollment-intent',version:1,chainId:1,contractVersion:1,mechanism:'direct-create',deployer:gasPayer,expectedVault,configuration:{preset,signers},...gas}};
 }else if(tag===1){
  const expectation=decodeSavingsExpectationFrame(r.field(160)),request=decodeSavingsActionRequestFrame(r.field(512)),workflowFingerprint=r.hash(),count=r.byte();if(count>2)throw Error('Too many approvals.');
  const authorizations=Array.from({length:count},()=>({kind:'drivekey-savings-authorization',version:1,chainId:1,contractVersion:1,
   vault:r.address(),signer:r.address(),fingerprint:r.hash(),expectationFingerprint:r.hash(),authorizationDigest:r.hash(),signature:'0x'+r.bytes(65).toString('hex'),...savingsTransactionFlags}));
  operation={kind:'relay',expectation,request,collection:{kind:'drivekey-savings-approval-collection',version:1,workflowFingerprint,authorizations,
   ...savingsTransactionFlags,receiptVerified:false,finalityVerified:false,dryRunOnly:true}};
 }else throw Error('Unsupported savings transaction purpose.');
 const unsignedTransaction='0x'+r.field(14000).toString('hex'),fingerprint=r.hash();r.end();
 const value=savingsTransactionRequestSchema.parse({kind:'drivekey-savings-transaction-request',version:1,chainId:1,requestId,deviceId,createdAt,expiresAt,gasPayer,gas,operation,unsignedTransaction,fingerprint});
 if(!frame.equals(encodeSavingsTransactionFrame(value)))throw Error('Noncanonical savings transaction frame.');return value;
}
export function encodeSavingsTransactionSigningFrame(request:unknown,vault:unknown,fingerprint:string,password:string){
 if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||typeof password!=='string'||password.length>256)throw Error('Invalid savings signing command.');
 const w=new W();w.bytes(Buffer.from('DKSTKEY1'));w.field(encodeSavingsTransactionFrame(request),MAX_SAVINGS_TRANSACTION_FRAME);w.field(encodeVaultFrame(vault),512);w.hash(fingerprint);w.text(password,1024);return w.finish(MAX_SAVINGS_TRANSACTION_SIGN_FRAME);
}
export function decodeSavingsTransactionSigningFrame(frame:Buffer){
 const r=new R(frame,MAX_SAVINGS_TRANSACTION_SIGN_FRAME);r.magic('DKSTKEY1');const request=decodeSavingsTransactionFrame(r.field(MAX_SAVINGS_TRANSACTION_FRAME)),vault=decodeVaultFrame(r.field(512)),fingerprint=r.hash(),password=r.text(1024);r.end();
 if(password.length>256)throw Error('Passphrase exceeds limit.');return {request,vault,fingerprint,password};
}
export function encodeSavingsTransactionResponseFrame(input:unknown){
 const s=savingsTransactionResponseSchema.parse(input),w=new W();w.bytes(Buffer.from('DKSTOUT1'));w.text(s.requestId,36);w.text(s.deviceId,36);w.hash(s.fingerprint);w.address(s.gasPayer);w.text(s.signedAt,64);w.field(Buffer.from(s.rawSignedTransaction.slice(2),'hex'),14100);w.hash(s.transactionHash);return w.finish(MAX_SAVINGS_TRANSACTION_RESPONSE_FRAME);
}
export function decodeSavingsTransactionResponseFrame(frame:Buffer){
 const r=new R(frame,MAX_SAVINGS_TRANSACTION_RESPONSE_FRAME);r.magic('DKSTOUT1');const requestId=r.text(36),deviceId=r.text(36),fingerprint=r.hash(),gasPayer=r.address(),signedAt=r.text(64),rawSignedTransaction='0x'+r.field(14100).toString('hex'),transactionHash=r.hash();r.end();
 return savingsTransactionResponseSchema.parse({kind:'drivekey-savings-transaction-response',version:1,requestId,deviceId,fingerprint,gasPayer,signedAt,rawSignedTransaction,transactionHash,...savingsTransactionFlags});
}
