import {VersionedMessage,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {validateExpiringJupiter,verifyExpiringJupiterResponse,expiringJupiterApproval} from '../core/jupiter-expiring-protocol';
import {decodeExpiringJupiterSigningFrame,encodeExpiringJupiterResponseFrame} from './jupiter-expiring-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signExpiringJupiterFrame(frame:Buffer):Promise<Buffer>{
 let secret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeExpiringJupiterSigningFrame(frame),r=validateExpiringJupiter(request);
  if(r.fingerprint!==fingerprint||vault.public.deviceId!==r.deviceId||vault.public.solanaAddress!==r.from)throw Error('Guarded swap changed or belongs to another vault.');
  const tx=new VersionedTransaction(VersionedMessage.deserialize(Buffer.from(r.unsignedMessage,'base64'))),keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,value=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(value instanceof Uint8Array)||value.byteLength!==64)throw Error('Unsupported secret storage.');secret=value;
  if(keys.sol.publicKey.toBase58()!==r.from)throw Error('Unlocked key differs from reviewed sender.');
  validateExpiringJupiter(r);tx.sign([{publicKey:keys.sol.publicKey,secretKey:secret}]);
  const response=verifyExpiringJupiterResponse({version:1,kind:'jupiter-expiring-swap',network:'solana',requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:Buffer.from(tx.serialize()).toString('base64'),transactionHash:bs58.encode(tx.signatures[0]),approvalSignature:bs58.encode(nacl.sign.detached(expiringJupiterApproval(r),secret))},r,vault.public);
  return encodeExpiringJupiterResponseFrame(response);
 }finally{secret?.fill(0);frame.fill(0);}
}
