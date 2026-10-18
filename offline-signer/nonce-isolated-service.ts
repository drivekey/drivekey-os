// Original nonce setup behavior with no broker key decryption.
import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseNonceRequestBytes,isolatedNonceResponse} from './nonce-isolation';
import {validateOfflineNonce,offlineNonceReview,verifyOfflineNonceResponse,type OfflineNonceRequest} from '../core/offline-nonce-protocol';
const command=z.discriminatedUnion('action',[z.object({scope:z.literal('trade'),action:z.literal('inspect')}).strict(),z.object({scope:z.literal('trade'),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string(),consent:z.literal(true)}).strict()]);
function freshNow(r:OfflineNonceRequest){const now=Date.now();if(now>=Date.parse(r.expiresAt)||Date.parse(r.createdAt)>now+10000)throw Error('Offline nonce request expired or clock changed.');}
export async function nonceOfflineAction(input:unknown,directory:string,initialRequestBytes?:Buffer){
 const c=command.parse(input);await assertOfflineEnvironment();const requestBytes=initialRequestBytes?Buffer.from(initialRequestBytes):await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'),vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=await validateOfflineNonce(await parseNonceRequestBytes(requestBytes),Date.now(),c.action==='sign'),v=await parseEncryptedVaultBytes(vaultBytes);if(v.public.deviceId!==r.deviceId||v.public.solanaAddress!==r.from)throw Error('Nonce request belongs to another offline wallet.');
 const unchanged=async()=>{if(!requestBytes.equals(await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Request or encrypted vault changed during nonce setup approval.');await validateOfflineNonce(r,Date.now(),c.action==='sign');if(c.action==='sign')freshNow(r);};await unchanged();
 if(c.action==='inspect'){const fresh=Date.now()<Date.parse(r.expiresAt);return {inspection:{state:fresh?'ready':'expired',canSign:fresh,review:offlineNonceReview(r),message:'Offline nonce creation. Inspect authority, deposit, fee and short deadline. No funds are sent by signing.'}};}
 if(c.fingerprint!==r.fingerprint)throw Error('Request changed since review.');await assertOfflineEnvironment();freshNow(r);const signed=await isolatedNonceResponse(r,v,c.fingerprint,c.password);
 // Worker and descendants must exit before media can be accessed again.
 await assertOfflineEnvironment();await unchanged();const response=await verifyOfflineNonceResponse(signed,r,v.public);freshNow(r);await writeBoundedExchangeBytes(directory,'signed-trade-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,message:'signed-trade-response.json saved and verified. Submit only while the original blockhash is valid.'};
}
