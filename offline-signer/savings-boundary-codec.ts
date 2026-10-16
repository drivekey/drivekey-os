// Small bounded binary interface between the public parser and signing worker.
// Original ISO strings/UUID case are retained: they are covered by existing hashes/AAD.
import {getAddress} from 'ethers';
import bs58 from 'bs58';
import {validateSavingsSetup,setupPurpose,type SetupPurpose} from '../core/savings-setup';
import {multiVaultSchema} from './multi-vault-format';

export const MAX_PUBLIC_FRAME=512, MAX_SIGN_FRAME=2048;
class Writer {
 private chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 byte(n:number){this.bytes(Buffer.from([n]));}
 short(n:number){const b=Buffer.alloc(2);b.writeUInt16BE(n);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');if(b.length>max)throw Error('Boundary string exceeds limit.');this.short(b.length);this.bytes(b);}
 finish(){return Buffer.concat(this.chunks);}
}
class Reader {
 private at=0;
 constructor(private b:Buffer,max:number){if(b.length>max)throw Error('Boundary frame exceeds limit.');}
 bytes(n:number){if(n<0||this.at+n>this.b.length)throw Error('Truncated boundary frame.');const v=this.b.subarray(this.at,this.at+n);this.at+=n;return v;}
 byte(){return this.bytes(1)[0];}
 short(){return this.bytes(2).readUInt16BE();}
 text(max:number){const n=this.short();if(n>max)throw Error('Boundary string exceeds limit.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.bytes(n));}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s,'ascii')))throw Error('Wrong boundary purpose/version.');}
 end(){if(this.at!==this.b.length)throw Error('Unexpected boundary data.');}
}
function address(r:Reader){return getAddress('0x'+r.bytes(20).toString('hex'));}
export function encodeSetupFrame(input:unknown){
 const s=validateSavingsSetup(input),w=new Writer();w.bytes(Buffer.from('DKSETUP1'));w.byte(s.preset==='strong'?1:0);
 w.text(s.sessionId,36);w.text(s.createdAt,64);w.text(s.expiresAt,64);w.bytes(Buffer.from(s.challenge.slice(2),'hex'));
 w.bytes(Buffer.from(s.spendingAccount.slice(2),'hex'));w.byte(s.signers.length);for(const a of s.signers)w.bytes(Buffer.from(a.slice(2),'hex'));
 return w.finish();
}
export function decodeSetupFrame(frame:Buffer){
 const r=new Reader(frame,MAX_PUBLIC_FRAME);r.magic('DKSETUP1');const p=r.byte();if(p>1)throw Error('Unsupported preset.');
 const sessionId=r.text(36),createdAt=r.text(64),expiresAt=r.text(64),challenge='0x'+r.bytes(32).toString('hex'),spendingAccount=address(r),count=r.byte();
 if(count!==(p?3:1))throw Error('Invalid signer count.');const signers=Array.from({length:count},()=>address(r));r.end();
 return validateSavingsSetup({kind:'drivekey-savings-setup',version:1,chainId:1,sessionId,createdAt,expiresAt,challenge,preset:p?'strong':'standard',spendingAccount,signers});
}
export function encodeVaultFrame(input:unknown){
 const v=multiVaultSchema.parse(input),w=new Writer();w.bytes(Buffer.from('DKVAULT3'));w.text(v.public.deviceId,36);w.text(v.public.createdAt,64);
 w.text(v.public.evmAddress,42);w.bytes(bs58.decode(v.public.solanaAddress));
 for(const value of [v.salt,v.iv,v.ciphertext,v.tag])w.bytes(Buffer.from(value,'hex'));return w.finish();
}
export function decodeVaultFrame(frame:Buffer){
 const r=new Reader(frame,MAX_PUBLIC_FRAME);r.magic('DKVAULT3');const deviceId=r.text(36),createdAt=r.text(64),evmAddress=r.text(42),solanaAddress=bs58.encode(r.bytes(32));
 const salt=r.bytes(32).toString('hex'),iv=r.bytes(12).toString('hex'),ciphertext=r.bytes(64).toString('hex'),tag=r.bytes(16).toString('hex');r.end();
 return multiVaultSchema.parse({kind:'drivekey-multi-vault',version:3,public:{version:3,deviceId,createdAt,evmAddress,solanaAddress},kdf:'scrypt-131072-8-1',salt,iv,ciphertext,tag});
}
export function encodeSetupSigningFrame(setup:unknown,vault:unknown,purpose:SetupPurpose,fingerprint:string,password:string){
 const p=setupPurpose.parse(purpose);if(!/^0x[0-9a-f]{64}$/.test(fingerprint)||password.length>256)throw Error('Invalid signing command.');
 const w=new Writer();w.bytes(Buffer.from('DKPROOF1'));w.byte(['register','restore','quorum'].indexOf(p));w.bytes(Buffer.from(fingerprint.slice(2),'hex'));
 for(const b of [encodeSetupFrame(setup),encodeVaultFrame(vault)]){w.short(b.length);w.bytes(b);}w.text(password,1024);return w.finish();
}
export function decodeSetupSigningFrame(frame:Buffer){
 const r=new Reader(frame,MAX_SIGN_FRAME);r.magic('DKPROOF1');const p=r.byte();if(p>2)throw Error('Unsupported proof purpose.');
 const fingerprint='0x'+r.bytes(32).toString('hex'),setup=decodeSetupFrame(r.bytes(r.short())),vault=decodeVaultFrame(r.bytes(r.short())),password=r.text(1024);r.end();
 if(password.length>256)throw Error('Passphrase exceeds limit.');return {setup,vault,password,fingerprint,purpose:['register','restore','quorum'][p] as SetupPurpose};
}
export function encodeProofSignature(signature:string){if(!/^0x[0-9a-fA-F]{130}$/.test(signature))throw Error('Invalid proof signature.');return Buffer.concat([Buffer.from('DKPROOF!'),Buffer.from(signature.slice(2),'hex')]);}
export function decodeProofSignature(frame:Buffer){const r=new Reader(frame,73);r.magic('DKPROOF!');const signature='0x'+r.bytes(65).toString('hex');r.end();return signature;}
