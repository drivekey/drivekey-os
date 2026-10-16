// One-shot key worker only: typed bounded frames, no media or network access.
import {Transaction,getAddress} from 'ethers';
import {validateWethConversion,wethConversionApproval,verifyWethConversionResponse} from '../core/weth-conversion-protocol';
import {decodeWethSigningFrame,encodeWethResponseFrame} from './weth-conversion-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signWethConversionFrame(frame:Buffer):Promise<Buffer>{
 let retainedSolSecret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeWethSigningFrame(frame),r=validateWethConversion(request);
  if(fingerprint!==r.fingerprint||vault.public.deviceId!==r.deviceId||getAddress(vault.public.evmAddress)!==getAddress(r.from))throw Error('Conversion differs from vault or review');
  const keys=await unlockMultiVault(vault,password),storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage');retainedSolSecret=secret;
  if(getAddress(keys.evm.address)!==getAddress(r.from))throw Error('Unlocked key differs');validateWethConversion(r);
  const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction)),approvalSignature=await keys.evm.signMessage(wethConversionApproval(r));
  return encodeWethResponseFrame(verifyWethConversionResponse({version:1,kind:'weth-conversion-response',requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,approvalSignature,transactionHash:Transaction.from(rawSignedTransaction).hash},r,vault.public));
 }finally{retainedSolSecret?.fill(0);frame.fill(0);}
 // JS string copies cannot be reliably erased; launcher must reap worker before media reads.
}
