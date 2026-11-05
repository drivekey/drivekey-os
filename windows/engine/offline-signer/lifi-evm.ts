import {Transaction} from 'ethers';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret} from './sol-secret';
import {validateLifiEvm,assertLifiEvmWallet,lifiEvmApproval,verifyLifiEvmResponse} from '../core/lifi-evm-intent';
export async function signLifiEvm(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateLifiEvm(JSON.parse(JSON.stringify(input)),now);assertLifiEvmWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('LI.FI fingerprint changed after review.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{validateLifiEvm(r,clock());const approvalSignature=await keys.evm.signMessage(lifiEvmApproval(r)),signingAt=clock();validateLifiEvm(r,signingAt);const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));return verifyLifiEvmResponse({version:12,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(signingAt).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash!,approvalSignature},r,vault.public,clock(),false);}finally{wipeSolSecret(keys.sol);}
}
