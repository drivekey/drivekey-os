// KEY PROCESS ONLY. Bounded typed fields; no raw media, arbitrary digest or call API.
import {Transaction} from 'ethers';
import {reviewSavingsTransaction,verifySavingsTransactionResponse,savingsTransactionFlags} from '../core/savings-transaction';
import {decodeSavingsTransactionSigningFrame,encodeSavingsTransactionResponseFrame} from './savings-transaction-codec';
import {unlockMultiVault} from './multi-vault';
export async function signSavingsTransactionFrame(frame:Buffer):Promise<Buffer>{
 let secret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeSavingsTransactionSigningFrame(frame);
  const check=()=>{const r=reviewSavingsTransaction(request);if(r.fingerprint!==fingerprint||request.deviceId!==vault.public.deviceId||request.gasPayer!==vault.public.evmAddress)throw Error('Savings gas wallet or review changed.');return r;};
  check();const keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,value=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(value instanceof Uint8Array)||value.byteLength!==64)throw Error('Unsupported decrypted key storage.');secret=value;
  if(keys.evm.address!==request.gasPayer)throw Error('Unlocked gas wallet differs from review.');
  check();const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(request.unsignedTransaction));check();
  const response=verifySavingsTransactionResponse({kind:'drivekey-savings-transaction-response',version:1,requestId:request.requestId,deviceId:request.deviceId,fingerprint,
   gasPayer:request.gasPayer,signedAt:new Date(Date.now()).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash,...savingsTransactionFlags},request);
  return encodeSavingsTransactionResponseFrame(response);
 }finally{secret?.fill(0);frame.fill(0);}
 // Runtime strings cannot be reliably erased. Launcher must await process exit.
}
