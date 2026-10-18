// KEY PROCESS ONLY. No media/file/JSON input, provider request, or broadcast API.
import {Transaction} from 'ethers';
import {validateLifiRequest,lifiApproval,verifyLifiResponse} from '../core/lifi-protocol';
import {decodeLifiSigningFrame,encodeLifiResponseFrame} from './lifi-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signLifiFrame(frame:Buffer):Promise<Buffer>{
 let retainedSolSecret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeLifiSigningFrame(frame);
  const r=validateLifiRequest(request);
  if(fingerprint!==r.fingerprint||vault.public.deviceId!==r.deviceId||vault.public.evmAddress.toLowerCase()!==r.from.toLowerCase())throw Error('LI.FI request changed or belongs to a different vault.');
  const transaction=Transaction.from(r.unsignedTransaction),approval=lifiApproval(r);
  const keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value;
  const secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage.');
  retainedSolSecret=secret;
  if(keys.evm.address.toLowerCase()!==r.from.toLowerCase())throw Error('Unlocked key differs from reviewed sender.');
  // KDF/signing can cross an absolute deadline. Never renew the existing request.
  validateLifiRequest(r);
  const rawSignedTransaction=await keys.evm.signTransaction(transaction),approvalSignature=await keys.evm.signMessage(approval);
  const response=verifyLifiResponse({version:9,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,approvalSignature,transactionHash:Transaction.from(rawSignedTransaction).hash},r,vault.public);
  return encodeLifiResponseFrame(response);
 }finally{retainedSolSecret?.fill(0);frame.fill(0);}
 // JS strings/copies cannot be reliably erased. The one-shot sandbox must exit
 // before the broker reads more media. This is not physical signing assurance.
}
