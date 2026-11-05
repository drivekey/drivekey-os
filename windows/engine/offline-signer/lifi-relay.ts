import {Transaction} from 'ethers';
import {VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {unlockMultiVault} from './multi-vault';
import {retainedSolSecret,wipeSolSecret} from './sol-secret';
import {validateLifiRelay,assertLifiRelayWallet,lifiRelayApproval,verifyLifiRelayResponse} from '../core/lifi-relay-intent';
export async function signLifiRelay(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateLifiRelay(JSON.parse(JSON.stringify(input)),now);assertLifiRelayWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Relay fingerprint changed after review.');const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{validateLifiRelay(r,clock());const approvalSignature=r.version===26?await keys.evm.signMessage(lifiRelayApproval(r)):bs58.encode(nacl.sign.detached(new TextEncoder().encode(lifiRelayApproval(r)),retainedSolSecret(keys.sol))),signingAt=clock();validateLifiRelay(r,signingAt);let rawSignedTransaction,transactionHash;if(r.version===26){rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));transactionHash=Transaction.from(rawSignedTransaction).hash!;}else{const tx=VersionedTransaction.deserialize(Buffer.from(r.unsignedTransaction,'base64'));tx.sign([keys.sol]);rawSignedTransaction=Buffer.from(tx.serialize()).toString('base64');transactionHash=bs58.encode(tx.signatures[0]);}return verifyLifiRelayResponse({version:r.version,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(signingAt).toISOString(),rawSignedTransaction,transactionHash,approvalSignature},r,vault.public,clock(),false);}finally{wipeSolSecret(keys.sol);}
}
