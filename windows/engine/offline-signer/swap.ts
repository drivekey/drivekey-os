import {Transaction} from 'ethers';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret} from './sol-secret';
import {validateSwap,assertSwapWallet,swapApproval,verifySwapResponse} from '../core/swap-intent';
export async function signSwap(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateSwap(JSON.parse(JSON.stringify(input)),now);assertSwapWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Swap fingerprint changed after review.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{validateSwap(r,clock());const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));return verifySwapResponse({version:9,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(clock()).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash!,approvalSignature:await keys.evm.signMessage(swapApproval(r))},r,vault.public,clock());}finally{wipeSolSecret(keys.sol);}
}
