import {z} from 'zod';
import {parseUnits} from 'ethers';
import {multiPublicSchema} from './multi-protocol';
import {validateWethConversion,verifyWethConversionResponse} from './weth-conversion-protocol';
import {parseStrictPublicJson} from './strict-public-json';
export const WETH_RECOVERY_KEY='drivekey-weth-conversion-recovery-v1';
export function bindPreparedWethConversion(input:unknown,walletInput:unknown,action:'wrap'|'unwrap',amount:string){const wallet=multiPublicSchema.parse(walletInput),request=validateWethConversion(input);if(request.deviceId!==wallet.deviceId||request.from.toLowerCase()!==wallet.evmAddress.toLowerCase()||request.action!==action||BigInt(request.amount)!==parseUnits(amount,18))throw Error('Prepared conversion differs from the selected wallet, action or amount.');return request;}
const schema=z.object({version:z.literal(1),kind:z.literal('weth-conversion-recovery'),wallet:multiPublicSchema,request:z.unknown(),response:z.unknown()}).strict();
export function validateWethRecovery(input:unknown){const a=schema.parse(input),request=validateWethConversion(a.request,Date.now(),false),response=verifyWethConversionResponse(a.response,request,a.wallet,Date.now(),false);return {version:1 as const,kind:'weth-conversion-recovery' as const,wallet:a.wallet,request,response};}
export function encodeWethRecovery(input:unknown){const text=JSON.stringify(validateWethRecovery(input));if(new TextEncoder().encode(text).length>16384)throw Error('Recovery record exceeds limit.');return text;}
export function decodeWethRecovery(text:string){return validateWethRecovery(parseStrictPublicJson(text,16384));}
