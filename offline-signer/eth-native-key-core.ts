// KEY PROCESS ONLY. Bounded typed input, no media, generic JSON or network API.
import {Transaction,getAddress} from 'ethers';
import {validateTrade,tradeApproval,verifyTradeResponse} from '../core/trade-protocol';
import {decodeEthNativeSigningFrame,encodeEthNativeResponseFrame} from './eth-native-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signEthNativeFrame(frame:Buffer):Promise<Buffer>{
 let retainedSolSecret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeEthNativeSigningFrame(frame),r=validateTrade(request);
  if(fingerprint!==r.fingerprint||vault.public.deviceId!==r.deviceId||getAddress(vault.public.evmAddress)!==getAddress(r.from))throw Error('Native payment changed or belongs to a different vault.');
  // validateTrade independently rebuilds the chain-1 type-2 plain transfer.
  const transaction=Transaction.from(r.unsignedTransaction),approval=tradeApproval(r),keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage.');retainedSolSecret=secret;
  if(getAddress(keys.evm.address)!==getAddress(r.from))throw Error('Unlocked key differs from reviewed sender.');
  validateTrade(r);
  const rawSignedTransaction=await keys.evm.signTransaction(transaction),approvalSignature=await keys.evm.signMessage(approval);
  const response=verifyTradeResponse({version:r.version,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,approvalSignature,transactionHash:Transaction.from(rawSignedTransaction).hash},r,vault.public);
  return encodeEthNativeResponseFrame(response);
 }finally{retainedSolSecret?.fill(0);frame.fill(0);}
 // JS strings/copies are not reliably erasable. The one-shot worker must exit
 // before media is reread. Application expiry cannot revoke signed ETH bytes.
}
