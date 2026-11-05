import {Transaction} from 'ethers';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret} from './sol-secret';
import {validateLifiEvm,assertLifiEvmWallet,lifiEvmApproval,verifyLifiEvmResponse} from '../core/lifi-evm-intent';
export async function signLifiEvm(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateLifiEvm(JSON.parse(JSON.stringify(input)),now);assertLifiEvmWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('LI.FI fingerprint changed after review.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{validateLifiEvm(r,clock());const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));return verifyLifiEvmResponse({version:12,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(clock()).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash!,approvalSignature:await keys.evm.signMessage(lifiEvmApproval(r))},r,vault.public,clock());}finally{wipeSolSecret(keys.sol);}
}
