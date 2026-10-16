import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseSavingsTransactionBytes,isolatedSavingsTransactionResponse} from './savings-transaction-isolation';
import {reviewSavingsTransaction,verifySavingsTransactionResponse} from '../core/savings-transaction';
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('savings-transaction'),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('savings-transaction'),action:z.literal('sign'),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true),password:z.string().max(256)}).strict(),
]);
export async function savingsTransactionOfflineAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();
 const requestBytes=await readBoundedExchangeBytes(directory,'savings-transaction-request.json'),vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=await parseSavingsTransactionBytes(requestBytes),vault=await parseEncryptedVaultBytes(vaultBytes);
 const check=()=>{const review=reviewSavingsTransaction(r);if(vault.public.deviceId!==r.deviceId||vault.public.evmAddress!==r.gasPayer)throw Error('Choose the exact everyday gas wallet.');return review;};
 const unchanged=async()=>{if(!requestBytes.equals(await readBoundedExchangeBytes(directory,'savings-transaction-request.json'))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Savings request or gas wallet changed.');return check();};
 const review=await unchanged();
 if(c.action==='inspect'){const {request:_,...display}=review;return {inspection:{state:'ready' as const,canSign:true,review:display,message:'Unfunded savings transaction. Review exact operation and gas cost. No transaction submitted.'}};}
 if(c.fingerprint!==review.fingerprint)throw Error('Savings transaction changed since review.');
 await assertOfflineEnvironment();const signed=await isolatedSavingsTransactionResponse(r,vault,c.fingerprint,c.password);
 await assertOfflineEnvironment();await unchanged();const response=verifySavingsTransactionResponse(signed,r);
 await writeBoundedExchangeBytes(directory,'savings-transaction-response.json',Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,response,message:'Savings transaction response saved and verified. Nothing submitted.'};
}
