// Key process only: bounded binary input; no host/media JSON, files or network.
import {Wallet,Transaction,decryptKeystoreJson,getAddress} from 'ethers';
import {validateRequest,approvalMessage,verifyResponse} from '../core/protocol';
import {decodeRobinhoodSigningFrame,encodeRobinhoodResponseFrame} from './robinhood-boundary-codec';
export async function signRobinhoodFrame(frame:Buffer):Promise<Buffer>{
 let account:Awaited<ReturnType<typeof decryptKeystoreJson>>|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeRobinhoodSigningFrame(frame),r=validateRequest(request);
  if(fingerprint!==r.fingerprint||r.deviceId!==vault.public.deviceId||getAddress(r.from)!==getAddress(vault.public.address))throw Error('Request changed or belongs to a different vault.');
  // Build bytes/domain only from the independently validated typed request.
  const tx=Transaction.from(r.unsignedTransaction),approval=approvalMessage(r);
  try{account=await decryptKeystoreJson(JSON.stringify(vault.keystore),password);}catch{throw Error('Incorrect passphrase or damaged encrypted vault. Nothing was signed.');}
  const signer=new Wallet(account.privateKey);
  if(getAddress(signer.address)!==getAddress(r.from))throw Error('Decrypted account mismatch.');
  validateRequest(r);
  const rawSignedTransaction=await signer.signTransaction(tx),approvalSignature=await signer.signMessage(approval);
  const now=Date.now(),response=verifyResponse({version:2,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,rawSignedTransaction,approvalSignature,signer:signer.address,transactionHash:Transaction.from(rawSignedTransaction).hash,signedAt:new Date(now).toISOString()},r,vault.public,now);
  return encodeRobinhoodResponseFrame(response);
 }finally{frame.fill(0);if(account)account.privateKey='';}
 // Replacing a string is not memory erasure. One-shot process exit is required;
 // JS/Ethers may retain key/password copies until process termination.
}
