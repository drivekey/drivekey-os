// Husher v8 broker: media bytes and public objects only; never decrypts a vault.
import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseHusherRequestBytes,isolatedHusherResponse} from './husher-isolation';
import {validateHusherDeposit,husherDepositReview,verifyHusherDepositResponse} from '../core/husher-deposit-protocol';
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('trade').optional(),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('trade').optional(),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().max(66),consent:z.literal(true)}).strict(),
]);
export async function husherOfflineAction(input:unknown,directory:string,initialRequestBytes?:Buffer){
 const c=command.parse(input);await assertOfflineEnvironment();
 const requestBytes=initialRequestBytes??await readBoundedExchangeBytes(directory,'unsigned-trade-request.json');
 const vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=validateHusherDeposit(await parseHusherRequestBytes(requestBytes),Date.now(),c.action==='sign'),p=r.payment;
 const v=await parseEncryptedVaultBytes(vaultBytes);
 if(v.public.deviceId!==p.deviceId||v.public.evmAddress.toLowerCase()!==p.from.toLowerCase())throw Error('Husher request belongs to a different vault.');
 const unchanged=async()=>{
  if(!requestBytes.equals(await readBoundedExchangeBytes(directory,'unsigned-trade-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Request or encrypted vault changed during Husher approval.');
  validateHusherDeposit(r,Date.now(),c.action==='sign');
 };
 await unchanged();
 if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(p.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(p.expiresAt),review:husherDepositReview(r,false),message:'Husher standard exchange deposit. Read the provider commitments and custodial warning before approving.'}};
 if(c.fingerprint!==r.fingerprint)throw Error('Husher request changed since review.');
 await assertOfflineEnvironment();const signed=await isolatedHusherResponse(r,v,c.fingerprint,c.password);
 // The sandbox resolves only after the key process and descendants are reaped.
 await assertOfflineEnvironment();await unchanged();
 const response=verifyHusherDepositResponse(signed,r,v.public);
 await writeBoundedExchangeBytes(directory,'signed-trade-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,message:'Provider-bound signed-trade-response.json saved and verified. No funds sent; payout not verified.'};
}
