import {Transaction} from 'ethers';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret} from './sol-secret';
import {validateSwap,assertSwapWallet,swapApproval,verifySwapResponse} from '../core/swap-intent';
export async function signSwap(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateSwap(JSON.parse(JSON.stringify(input)),now);assertSwapWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Swap fingerprint changed after review.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{validateSwap(r,clock());const approvalSignature=await keys.evm.signMessage(swapApproval(r)),signingAt=clock();validateSwap(r,signingAt);const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));return verifySwapResponse({version:9,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(signingAt).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash!,approvalSignature},r,vault.public,clock(),false);}finally{wipeSolSecret(keys.sol);}
}
