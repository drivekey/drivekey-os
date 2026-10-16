// KEY PROCESS ONLY. No media/file/JSON input, provider API or broadcast path.
import {Transaction} from 'ethers';
import {validateHusherDeposit,husherDepositApproval,verifyHusherDepositResponse} from '../core/husher-deposit-protocol';
import {decodeHusherSigningFrame,encodeHusherResponseFrame} from './husher-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signHusherFrame(frame:Buffer):Promise<Buffer>{
 let retainedSolSecret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeHusherSigningFrame(frame),r=validateHusherDeposit(request),p=r.payment;
  if(fingerprint!==r.fingerprint||vault.public.deviceId!==p.deviceId||vault.public.evmAddress.toLowerCase()!==p.from.toLowerCase())throw Error('Husher request changed or belongs to a different vault.');
  const transaction=Transaction.from(p.unsignedTransaction),approval=husherDepositApproval(r);
  const keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage.');retainedSolSecret=secret;
  if(keys.evm.address.toLowerCase()!==p.from.toLowerCase())throw Error('Unlocked key differs from reviewed sender.');
  // Recheck absolute request and provider deadlines after KDF; never extend them.
  validateHusherDeposit(r);
  const rawSignedTransaction=await keys.evm.signTransaction(transaction),approvalSignature=await keys.evm.signMessage(approval);
  const response=verifyHusherDepositResponse({version:8,requestId:p.requestId,deviceId:p.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,approvalSignature,transactionHash:Transaction.from(rawSignedTransaction).hash},r,vault.public);
  return encodeHusherResponseFrame(response);
 }finally{retainedSolSecret?.fill(0);frame.fill(0);}
 // JavaScript strings/copies are not reliably erased; the one-shot process must
 // exit before further media access. This does not verify provider commitments.
}
