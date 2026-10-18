// Public broker: parsing happens before, and media access after, the key process.
import {z} from 'zod';
import {getAddress} from 'ethers';
import {multiReview,validateMultiRequest,verifyMultiResponse} from '../core/multi-protocol';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseMultiRequestBytes,isolatedMultiResponse} from './multi-isolation';
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('multi'),action:z.literal('review')}).strict(),
 z.object({scope:z.literal('multi'),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true)}).strict(),
]);
export async function multiTransferOfflineAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();
 const requestBytes=await readBoundedExchangeBytes(directory,'unsigned-multi-request.json'),vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 // Keep existing multi review behavior: expired requests must be recreated.
 const r=validateMultiRequest(await parseMultiRequestBytes(requestBytes)),v=await parseEncryptedVaultBytes(vaultBytes);
 if(v.public.deviceId!==r.deviceId||(r.network==='solana'?r.from!==v.public.solanaAddress:getAddress(r.from)!==getAddress(v.public.evmAddress)))throw Error('Request belongs to a different vault.');
 const unchanged=async()=>{
  if(!requestBytes.equals(await readBoundedExchangeBytes(directory,'unsigned-multi-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Request or encrypted vault changed during transfer approval.');
  validateMultiRequest(r);
 };
 await unchanged();
 if(c.action==='review')return {review:{...multiReview(r),deadlineUTC:r.expiresAt},message:'Read every field. Token metadata and RPC state are untrusted claims; verify independently.'};
 if(c.fingerprint!==r.fingerprint)throw Error('Request changed since review.');
 await assertOfflineEnvironment();const signed=await isolatedMultiResponse(r,v,c.fingerprint,c.password);
 await assertOfflineEnvironment();await unchanged();const response=verifyMultiResponse(signed,r,v.public);
 await writeBoundedExchangeBytes(directory,'signed-multi-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,message:'signed-multi-response.json saved and independently verified. No funds sent.'};
}
