import {VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {nonceControlMessage,nonceControlApproval,validateNonceControl,verifyNonceControlResponse} from '../core/solana-nonce-control';
import {decodeNonceControlSigningFrame,encodeNonceControlResponseFrame} from './nonce-control-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signNonceControlFrame(frame:Buffer){let secret:Uint8Array|undefined;
 try{const {request,vault,fingerprint,password}=decodeNonceControlSigningFrame(frame),r=validateNonceControl(request);
 if(r.fingerprint!==fingerprint||vault.public.deviceId!==r.deviceId||vault.public.solanaAddress!==r.from)throw Error('Nonce control changed or belongs to another wallet.');
 const tx=new VersionedTransaction(nonceControlMessage(r)),keys=await unlockMultiVault(vault,password),storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,value=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
 if(!(value instanceof Uint8Array)||value.byteLength!==64)throw Error('Unsupported secret storage.');secret=value;if(keys.sol.publicKey.toBase58()!==r.from)throw Error('Unlocked owner differs.');validateNonceControl(r);tx.sign([{publicKey:keys.sol.publicKey,secretKey:secret}]);
 const response=verifyNonceControlResponse({version:1,kind:'solana-nonce-invalidate',network:'solana',requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:Buffer.from(tx.serialize()).toString('base64'),transactionHash:bs58.encode(tx.signatures[0]),approvalSignature:bs58.encode(nacl.sign.detached(nonceControlApproval(r),secret))},r,vault.public);return encodeNonceControlResponseFrame(response);
 }finally{secret?.fill(0);frame.fill(0);}
}
