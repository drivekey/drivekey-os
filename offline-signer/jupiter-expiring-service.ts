import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseExpiringJupiterBytes,isolatedExpiringJupiterResponse} from './jupiter-expiring-isolation';
import {validateExpiringJupiter,expiringJupiterReview,verifyExpiringJupiterResponse} from '../core/jupiter-expiring-protocol';
const command=z.discriminatedUnion('action',[z.object({scope:z.literal('trade').optional(),action:z.literal('inspect')}).strict(),z.object({scope:z.literal('trade').optional(),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true)}).strict()]);
export async function expiringJupiterOfflineAction(input:unknown,directory:string,initialRequestBytes?:Buffer){
 const c=command.parse(input);await assertOfflineEnvironment();
 const bytes=initialRequestBytes?Buffer.from(initialRequestBytes):await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'),vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=validateExpiringJupiter(await parseExpiringJupiterBytes(bytes),Date.now(),c.action==='sign'),v=await parseEncryptedVaultBytes(vaultBytes);
 if(v.public.deviceId!==r.deviceId||v.public.solanaAddress!==r.from)throw Error('Guarded swap belongs to another vault.');
 const unchanged=async()=>{if(!bytes.equals(await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Guarded approval input changed.');validateExpiringJupiter(r,Date.now(),c.action==='sign');};await unchanged();
 if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(r.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(r.expiresAt),review:expiringJupiterReview(r,false),message:'Review the exact swap and its on-chain deadline. Nothing signed.'}};
 if(c.fingerprint!==r.fingerprint)throw Error('Guarded swap changed since review.');await assertOfflineEnvironment();
 const signed=await isolatedExpiringJupiterResponse(r,v,c.fingerprint,c.password);await assertOfflineEnvironment();await unchanged();const response=verifyExpiringJupiterResponse(signed,r,v.public);
 await writeBoundedExchangeBytes(directory,'signed-trade-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));return {hash:response.transactionHash,message:'Guarded swap response saved. No funds sent.'};
}
