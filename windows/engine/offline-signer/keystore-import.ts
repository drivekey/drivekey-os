// Imported ONLY by a local disposable provisioning process and crypto tests.
// No renderer, provider, merchant or networking imports are allowed here.
import {getAddress, decryptKeystoreJson,Wallet} from 'ethers';
import {importEvmBytes} from './multi-vault';
import {checkPassword} from './vault';
export const LOCAL_IMPORT_MESSAGES={
 KEY_FORMAT:'The local key must be 64 hexadecimal characters, with an optional 0x prefix. Do not enter a seed phrase.',
 KEY_INVALID:'The supplied value is not a valid Ethereum private key.',
 ADDRESS_MISMATCH:'The key does not match the configured public wallet address. Check the local key export.',
 PASSPHRASE_LENGTH:'The new passphrase must contain 16–256 characters.',
 KEYSTORE_INVALID:'The encrypted keystore format or KDF parameters are unsupported.',
 KEYSTORE_UNLOCK:'The keystore could not be unlocked. Check its local password and original file.',
} as const;
export class LocalImportError extends Error{constructor(readonly code:keyof typeof LOCAL_IMPORT_MESSAGES){super(LOCAL_IMPORT_MESSAGES[code]);}}
export function validateLocalEthereumKey(value:unknown,expectedAddress:string):string{
 if(typeof value!=='string'||! /^(?:0x)?[0-9a-fA-F]{64}$/.test(value.trim()))throw new LocalImportError('KEY_FORMAT');
 let actual:string;try{actual=new Wallet('0x'+value.trim().replace(/^0x/,'')).address;}catch{throw new LocalImportError('KEY_INVALID');}
 if(getAddress(expectedAddress)!==actual)throw new LocalImportError('ADDRESS_MISMATCH');return actual;
}

function hex(value:unknown,bytes:number){return typeof value==='string'&&new RegExp('^[0-9a-fA-F]{'+bytes*2+'}$').test(value);}
function integer(value:unknown,min:number,max:number):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;}
/** Bound KDF work BEFORE calling the third-party decryptor. Strip optional mnemonic metadata. */
export function checkedEthereumKeystore(value:unknown){
 let raw:string;try{raw=JSON.stringify(value);}catch{throw Error('Expected a bounded Ethereum V3 keystore.');}
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)throw Error('Keystore exceeds the local import limit.');
 const v=JSON.parse(raw),c=v?.crypto??v?.Crypto;
 if(!v||v.version!==3||!hex(v.address,20)||(v.crypto&&v.Crypto)||!c||c.cipher!=='aes-128-ctr'||!hex(c.cipherparams?.iv,16)||!hex(c.ciphertext,32)||!hex(c.mac,32))throw Error('Unsupported Ethereum V3 keystore.');
 const p=c.kdfparams;if(!p||p.dklen!==32||typeof p.salt!=='string'||! /^[0-9a-fA-F]{32,128}$/.test(p.salt)||p.salt.length%2)throw Error('Unsupported keystore KDF parameters.');
 let params:any;
 if(c.kdf==='scrypt'){
  const n=p.n??p.N;if(p.n!==undefined&&p.N!==undefined)throw Error('Ambiguous scrypt work factor.');
  if(!integer(n,16384,262144)||(n&(n-1))!==0||!integer(p.r,1,8)||!integer(p.p,1,4)||n*p.r>2097152||n*p.r*p.p>4194304)throw Error('Keystore KDF work exceeds local policy.');
  params={dklen:32,n,r:p.r,p:p.p,salt:p.salt};
 }else if(c.kdf==='pbkdf2'){
  if(!integer(p.c,10000,1000000)||p.prf!=='hmac-sha256')throw Error('Unsupported PBKDF2 work factor.');params={dklen:32,c:p.c,prf:p.prf,salt:p.salt};
 }else throw Error('Unsupported keystore KDF.');
 return {version:3,address:v.address,crypto:{cipher:'aes-128-ctr',cipherparams:{iv:c.cipherparams.iv},ciphertext:c.ciphertext,kdf:c.kdf,kdfparams:params,mac:c.mac}};
}
export async function importLocalEthereumKey(value:unknown,newPassword:string,expectedAddress:string){
 if(typeof newPassword!=='string'||newPassword.length<16||newPassword.length>256)throw new LocalImportError('PASSPHRASE_LENGTH');let key:Buffer|undefined;
 try{
  validateLocalEthereumKey(value,expectedAddress);
  key=Buffer.from((value as string).trim().replace(/^0x/,''),'hex');return await importEvmBytes(key,newPassword,expectedAddress);
 }catch(error){if(error instanceof LocalImportError)throw error;throw Error('Local Ethereum import failed. Check the format, address and passphrase locally.');}
 finally{key?.fill(0);}
}
export async function importLocalEthereumKeystore(value:unknown,oldPassword:string,newPassword:string,expectedAddress:string){
 checkPassword(newPassword);let key:Buffer|undefined;
 try{
  const v=checkedEthereumKeystore(value);
  if(typeof oldPassword!=='string'||oldPassword.length>1024||getAddress('0x'+v.address.toLowerCase())!==getAddress(expectedAddress))throw Error('Keystore public identity mismatch.');
  const account=await decryptKeystoreJson(JSON.stringify(v),oldPassword);
  key=Buffer.from(account.privateKey.slice(2),'hex');return await importEvmBytes(key,newPassword,expectedAddress);
 }catch{throw Error('Encrypted Ethereum import failed. Check the keystore, address and passphrases locally.');}
 finally{key?.fill(0);}
}
