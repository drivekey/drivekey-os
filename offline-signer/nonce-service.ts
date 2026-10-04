import {z} from 'zod';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {assertOfflineEnvironment} from './environment';
import {readJsonFile,safeDirectory,writeJsonFile} from '../core/files';
import {multiVaultSchema,unlockMultiVault} from './multi-vault';
import {validateOfflineNonce,offlineNonceTransaction,offlineNonceApproval,offlineNonceReview,verifyOfflineNonceResponse} from '../core/offline-nonce-protocol';
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('trade'),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('trade'),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string(),consent:z.literal(true)}).strict(),
]);
export async function offlineNonceSignAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();await safeDirectory(directory);
 const r=await validateOfflineNonce(await readJsonFile(directory,'unsigned-trade-request.json'),Date.now(),c.action==='sign'),vault=multiVaultSchema.parse(await readJsonFile(directory,'vault-multi-encrypted.json'));
 if(vault.public.deviceId!==r.deviceId||vault.public.solanaAddress!==r.from)throw Error('Nonce request belongs to another offline wallet.');
 if(c.action==='inspect'){const fresh=Date.now()<Date.parse(r.expiresAt);return {inspection:{state:fresh?'ready':'expired',canSign:fresh,review:offlineNonceReview(r),message:'Offline nonce creation. Inspect authority, deposit, fee and short deadline. No funds are sent by signing.'}};}
 if(c.fingerprint!==r.fingerprint)throw Error('Request changed since review.');
 const keys=await unlockMultiVault(vault,c.password);
 try{
  const tx=offlineNonceTransaction(r);tx.sign(keys.sol);
  const response=await verifyOfflineNonceResponse({version:5,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:tx.serialize().toString('base64'),approvalSignature:bs58.encode(nacl.sign.detached(offlineNonceApproval(r),keys.sol.secretKey)),transactionHash:bs58.encode(tx.signature!)},r,vault.public);
  await assertOfflineEnvironment();await validateOfflineNonce(r);
  if((await validateOfflineNonce(await readJsonFile(directory,'unsigned-trade-request.json'))).fingerprint!==r.fingerprint)throw Error('Request changed during signing.');
  await writeJsonFile(directory,'signed-trade-response.json',response,true);
  return {hash:response.transactionHash,message:'signed-trade-response.json saved and verified. Submit only while the original blockhash is valid.'};
 }finally{keys.sol.secretKey.fill(0);}
}
