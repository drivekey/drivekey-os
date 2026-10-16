// Existing Ethereum contract-action broker. Never decrypts an encrypted vault.
import {z} from 'zod';
import {getAddress} from 'ethers';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseEthTradeRequestBytes,isolatedEthTradeResponse} from './eth-trade-isolation';
import {validateTrade,tradeReview,verifyTradeResponse} from '../core/trade-protocol';
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('trade').optional(),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('trade').optional(),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true)}).strict(),
]);
export async function ethTradeOfflineAction(input:unknown,directory:string,initialRequestBytes?:Buffer){
 const c=command.parse(input);await assertOfflineEnvironment();
 const requestBytes=initialRequestBytes?Buffer.from(initialRequestBytes):await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'),vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=validateTrade(await parseEthTradeRequestBytes(requestBytes),Date.now(),c.action==='sign'),v=await parseEncryptedVaultBytes(vaultBytes);
 if(v.public.deviceId!==r.deviceId||getAddress(v.public.evmAddress)!==getAddress(r.from))throw Error('Ethereum trade belongs to a different vault.');
 const unchanged=async()=>{
  if(!requestBytes.equals(await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Request or encrypted vault changed during Ethereum trade approval.');
  validateTrade(r,Date.now(),c.action==='sign');
 };
 await unchanged();
 if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(r.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(r.expiresAt),review:tradeReview(r,false),message:'Ethereum release-candidate transaction. Review every field before signing.'}};
 if(c.fingerprint!==r.fingerprint)throw Error('Ethereum trade changed since review.');
 await assertOfflineEnvironment();const signed=await isolatedEthTradeResponse(r,v,c.fingerprint,c.password);
 // The launcher resolves only after the key worker and descendants have exited.
 await assertOfflineEnvironment();await unchanged();const response=verifyTradeResponse(signed,r,v.public);
 await writeBoundedExchangeBytes(directory,'signed-trade-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,message:'Ethereum signed-trade-response.json saved and verified. No funds sent.'};
}
