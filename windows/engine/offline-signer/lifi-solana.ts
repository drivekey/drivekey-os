import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {unlockMultiVault} from './multi-vault';
import {retainedSolSecret,wipeSolSecret} from './sol-secret';
import {validateLifiSolana,assertLifiSolanaWallet,lifiSolanaApproval,verifyLifiSolanaResponse} from '../core/lifi-solana-intent';
export async function signLifiSolana(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateLifiSolana(JSON.parse(JSON.stringify(input)),now);assertLifiSolanaWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Solana swap fingerprint changed after review.');const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{const approvalSignature=bs58.encode(nacl.sign.detached(lifiSolanaApproval(r),retainedSolSecret(keys.sol))),signingAt=clock();validateLifiSolana(r,signingAt);const tx=VersionedTransaction.deserialize(Buffer.from(r.unsignedTransaction,'base64'));tx.sign([keys.sol]);return verifyLifiSolanaResponse({version:11,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(signingAt).toISOString(),rawSignedTransaction:Buffer.from(tx.serialize()).toString('base64'),transactionHash:bs58.encode(tx.signatures[0]),approvalSignature},r,vault.public,clock(),false);}finally{wipeSolSecret(keys.sol);}
}
