// KEY PROCESS ONLY. No raw JSON/file/network input. Independently revalidates bytes.
import {Transaction,getAddress} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {canonicalSolTransaction,multiApproval,validateMultiRequest,verifyMultiResponse} from '../core/multi-protocol';
import {decodeMultiSigningFrame,encodeMultiResponseFrame} from './multi-boundary-codec';
import {unlockMultiVault} from './multi-vault';
export async function signMultiFrame(frame:Buffer):Promise<Buffer>{
 let retainedSolSecret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeMultiSigningFrame(frame),r=validateMultiRequest(request);
  if(fingerprint!==r.fingerprint||vault.public.deviceId!==r.deviceId||(r.network==='solana'?r.from!==vault.public.solanaAddress:getAddress(r.from)!==getAddress(vault.public.evmAddress)))throw Error('Transfer changed or belongs to a different vault.');
  const approval=multiApproval(r),keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage.');retainedSolSecret=secret;
  if(getAddress(keys.evm.address)!==getAddress(vault.public.evmAddress)||keys.sol.publicKey.toBase58()!==vault.public.solanaAddress)throw Error('Unlocked keys differ from reviewed wallet.');
  validateMultiRequest(r);
  let rawSignedTransaction:string,approvalSignature:string,transactionHash:string;
  if(r.network==='robinhood'){
   rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));approvalSignature=await keys.evm.signMessage(approval);transactionHash=Transaction.from(rawSignedTransaction).hash!;
  }else{
   const tx=canonicalSolTransaction(r);tx.sign(keys.sol);rawSignedTransaction=tx.serialize().toString('base64');transactionHash=bs58.encode(tx.signature!);approvalSignature=bs58.encode(nacl.sign.detached(new TextEncoder().encode(approval),retainedSolSecret));
  }
  return encodeMultiResponseFrame(verifyMultiResponse({version:r.version,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,approvalSignature,transactionHash},r,vault.public));
 }finally{retainedSolSecret?.fill(0);frame.fill(0);}
 // Runtime string copies cannot be reliably erased; the one-shot process exits.
}
