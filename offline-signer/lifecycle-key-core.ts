// One-shot key process: typed bounded frames; never host/media JSON or filesystem.
import {createOfflineVault,checkOfflineVaultPassword} from './vault';
import {createMultiVault,unlockMultiVault,upgradeMultiVault} from './multi-vault';
import {decodeLifecycleCommand,encodeLifecycleResult,type LifecycleVault} from './lifecycle-boundary-codec';
async function verify(vault:LifecycleVault,password:string){
 if(vault.version===2){await checkOfflineVaultPassword(vault,password);return;}
 const keys=await unlockMultiVault(vault,password);let retained:Uint8Array|undefined;
 try{
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value;
  const bytes=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==64)throw Error('Unsupported key storage.');retained=bytes;
  if(keys.evm.address!==vault.public.evmAddress||keys.sol.publicKey.toBase58()!==vault.public.solanaAddress)throw Error('Decrypted public identity differs.');
 }finally{retained?.fill(0);}
}
export async function runLifecycleFrame(frame:Buffer){
 try{
  const c=decodeLifecycleCommand(frame);
  const vault=c.operation==='create-v2'?await createOfflineVault(c.password):c.operation==='create-v3'?await createMultiVault(c.password):c.operation==='upgrade'?await upgradeMultiVault(c.vault,c.password,true):c.vault!;
  // Generated, upgraded and supplied encrypted vaults all require a successful
  // decryption and independently derived public metadata before leaving worker.
  await verify(vault,c.password);
  return encodeLifecycleResult(c.operation,c.binding,vault);
 }finally{frame.fill(0);}
 // JS/Ethers string/runtime copies cannot be guaranteed erased. Exit is mandatory.
}
