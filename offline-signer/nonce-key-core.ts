// One-shot key process: bounded typed input, no media/JSON parser/network API.
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {validateOfflineNonce,offlineNonceTransaction,offlineNonceApproval,verifyOfflineNonceResponse,type OfflineNonceRequest} from '../core/offline-nonce-protocol';
import {decodeNonceSigningFrame,encodeNonceResponseFrame} from './nonce-boundary-codec';
import {unlockMultiVault} from './multi-vault';
function freshNow(r:OfflineNonceRequest){const now=Date.now();if(now>=Date.parse(r.expiresAt)||Date.parse(r.createdAt)>now+10000)throw Error('Offline nonce request expired or clock changed.');}
export async function signNonceFrame(frame:Buffer):Promise<Buffer>{
 let retainedSolSecret:Uint8Array|undefined;
 try{
  const {request,vault,fingerprint,password}=decodeNonceSigningFrame(frame),r=await validateOfflineNonce(request);freshNow(r);
  if(r.fingerprint!==fingerprint||vault.public.deviceId!==r.deviceId||vault.public.solanaAddress!==r.from)throw Error('Nonce setup changed or belongs to a different vault.');
  // Rebuild create-with-seed and initialize-nonce with one payer/base/authority,
  // exact system program/deposit and original recent blockhash before unlock.
  const tx=offlineNonceTransaction(r),keys=await unlockMultiVault(vault,password);
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value,secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage.');retainedSolSecret=secret;
  if(keys.sol.publicKey.toBase58()!==r.from)throw Error('Unlocked key differs from reviewed nonce payer.');
  await validateOfflineNonce(r);freshNow(r);tx.sign({publicKey:keys.sol.publicKey,secretKey:retainedSolSecret});
  const response=await verifyOfflineNonceResponse({version:5,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:tx.serialize().toString('base64'),transactionHash:bs58.encode(tx.signature!),approvalSignature:bs58.encode(nacl.sign.detached(offlineNonceApproval(r),retainedSolSecret))},r,vault.public);
  freshNow(r);return encodeNonceResponseFrame(response);
 }finally{retainedSolSecret?.fill(0);frame.fill(0);}
 // JS copies/strings are not reliably erasable. A dead worker is mandatory.
 // Offline signing cannot authenticate current block height or blockhash life.
}
