import {z} from 'zod';
import {getAddress} from 'ethers';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {parseWethConversionBytes,isolatedWethConversionResponse} from './weth-conversion-isolation';
import {WETH_CONVERSION_FILES,validateWethConversion,wethConversionReview,verifyWethConversionResponse} from '../core/weth-conversion-protocol';
const command=z.discriminatedUnion('action',[z.object({scope:z.literal('weth-conversion'),action:z.literal('inspect')}).strict(),z.object({scope:z.literal('weth-conversion'),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true)}).strict()]);
export async function wethConversionOfflineAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();
 const requestBytes=await readBoundedExchangeBytes(directory,WETH_CONVERSION_FILES.request),vaultBytes=await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json');
 const r=validateWethConversion(await parseWethConversionBytes(requestBytes),Date.now(),c.action==='sign'),v=await parseEncryptedVaultBytes(vaultBytes);
 if(v.public.deviceId!==r.deviceId||getAddress(v.public.evmAddress)!==getAddress(r.from))throw Error('Conversion belongs to another vault.');
 const unchanged=async()=>{if(!requestBytes.equals(await readBoundedExchangeBytes(directory,WETH_CONVERSION_FILES.request))||!vaultBytes.equals(await readBoundedExchangeBytes(directory,'vault-multi-encrypted.json')))throw Error('Conversion or vault changed during approval.');validateWethConversion(r,Date.now(),c.action==='sign');};
 await unchanged();if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(r.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(r.expiresAt),review:wethConversionReview(r,false),message:'WETH conversion only. No swap or allowance.'}};
 if(c.fingerprint!==r.fingerprint)throw Error('Conversion changed since review.');await assertOfflineEnvironment();
 const signed=await isolatedWethConversionResponse(r,v,c.fingerprint,c.password);
 await assertOfflineEnvironment();await unchanged();const response=verifyWethConversionResponse(signed,r,v.public);
 await writeBoundedExchangeBytes(directory,WETH_CONVERSION_FILES.response,Buffer.from(JSON.stringify(response,null,2)+'\n'));
 return {hash:response.transactionHash,message:'Signed WETH conversion saved. No funds sent and no swap completed.'};
}
