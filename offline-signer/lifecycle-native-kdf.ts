// Installed only by the one-shot lifecycle and Robinhood key entries. Existing
// vault files keep their algorithms, password handling and fixed KDF parameters.
import {scrypt as nativeScrypt} from 'node:crypto';
import {scrypt as ethersScrypt} from 'ethers';
export function deriveLifecycleV2Key(password:Uint8Array,salt:Uint8Array,N:number,r:number,p:number,dkLen:number):Promise<Uint8Array>{
 if(!(password instanceof Uint8Array)||password.byteLength>1024||!(salt instanceof Uint8Array)||salt.byteLength!==32||N!==131072||r!==8||p!==1||dkLen!==64)throw Error('Unsupported lifecycle KDF parameters.');
 return new Promise((resolve,reject)=>nativeScrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:192*1024*1024},(error,key)=>{
  if(error){if(Buffer.isBuffer(key))key.fill(0);reject(Error('Lifecycle native KDF failed.'));return;}
  if(!Buffer.isBuffer(key)||key.length!==64){if(Buffer.isBuffer(key))key.fill(0);reject(Error('Lifecycle native KDF returned invalid bytes.'));return;}
  resolve(key);
 }));
}
export function installLifecycleNativeKdf(){
 // Ethers' existing-format implementation still normalizes the password and
 // performs AES/MAC/address checks. Its internal derived length is 64 bytes;
 // the unchanged keystore wire field remains dklen:32.
 ethersScrypt.register(deriveLifecycleV2Key);ethersScrypt.lock();
}
