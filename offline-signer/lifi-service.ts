// LI.FI v9 broker: media bytes and public objects only; never decrypts a vault.
import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseLifiRequestBytes,isolatedLifiResponse} from './lifi-isolation';
import {validateLifiRequest,lifiReview,verifyLifiResponse} from '../core/lifi-protocol';
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('trade').optional(),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('trade').optional(),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().max(66),consent:z.literal(true)}).strict(),
]);
export async function lifiOfflineAction(input:unknown,directory:string,initialRequestBytes?:Buffer){
 const c=command.parse(input);await assertOfflineEnvironment();
 const requestBytes=initialRequestBytes??await readBoundedExchangeBytes(directory,'unsigned-trade-request.json');
 const vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=validateLifiRequest(await parseLifiRequestBytes(requestBytes),Date.now(),c.action==='sign');
 const v=await parseEncryptedVaultBytes(vaultBytes);
 if(v.public.deviceId!==r.deviceId||v.public.evmAddress.toLowerCase()!==r.from.toLowerCase())throw Error('LI.FI request belongs to a different vault.');
 const unchanged=async()=>{
  if(!requestBytes.equals(await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Request or encrypted vault changed during LI.FI approval.');
  validateLifiRequest(r,Date.now(),c.action==='sign');
 };
 await unchanged();
 if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(r.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(r.expiresAt),review:lifiReview(r,false),message:'Native ETH to USDC on Ethereum. Review amount, minimum received and maximum gas.'}};
 if(c.fingerprint!==r.fingerprint)throw Error('LI.FI request changed since review.');
 await assertOfflineEnvironment();
 const signed=await isolatedLifiResponse(r,v,c.fingerprint,c.password);
 // runSandbox resolves only after the secret-bearing child has exited/reaped.
 await assertOfflineEnvironment();await unchanged();
 const response=verifyLifiResponse(signed,r,v.public);
 await writeBoundedExchangeBytes(directory,'signed-trade-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,message:'LI.FI signed-trade-response.json saved and verified. No funds sent.'};
}
