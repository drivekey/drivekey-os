import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { SOL_USDC } from './payment-request';
import { inspectDirectJupiterRoute } from './jupiter-route-inspection';
import { validateJupiterAncillary } from './jupiter-account-policy';
import {readJupiterResponse} from './jupiter-response';
export const SOL_MINT='So11111111111111111111111111111111111111112';
export const SOL_SWAP_BLOCKER='This quote inspection endpoint exports no signable transaction. Use restricted swap preparation with a wallet and durable nonce. Broadcasting remains disabled pending full settlement acceptance.';
const inputSchema=z.object({from:z.string().refine(v=>{try{return PublicKey.isOnCurve(new PublicKey(v).toBytes());}catch{return false;}}),inputMint:z.enum([SOL_MINT,SOL_USDC]),amount:z.string().regex(/^[1-9][0-9]{0,19}$/).refine(v=>BigInt(v)<2n**64n),slippageBps:z.number().int().min(0).max(100).default(50)}).strict();
// Research/quote boundary only. Never forwards opaque instructions to the signer.
export async function inspectJupiterBuild(input:unknown,key:string|undefined,fetcher:typeof fetch=fetch){
 const a=inputSchema.parse(input);
 const outputMint=a.inputMint===SOL_MINT?SOL_USDC:SOL_MINT;
 const response=await fetcher('https://api.jup.ag/swap/v2/build?'+new URLSearchParams({inputMint:a.inputMint,outputMint,amount:a.amount,taker:a.from,slippageBps:String(a.slippageBps),dexes:'Raydium CLMM',maxAccounts:'24'}),{headers:key?{'x-api-key':key}:{},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 const body=await readJupiterResponse(response);
 const q=z.object({inputMint:z.literal(a.inputMint),outputMint:z.literal(outputMint),inAmount:z.literal(a.amount),outAmount:z.string().regex(/^[1-9][0-9]{0,19}$/),otherAmountThreshold:z.string().regex(/^[1-9][0-9]{0,19}$/),slippageBps:z.literal(a.slippageBps),swapMode:z.literal('ExactIn')}).parse(body);
 let inspection;
 try{inspection={...inspectDirectJupiterRoute(body,a),ancillary:validateJupiterAncillary(body,a)};}
 catch{inspection={state:'unsupported-route',signingEnabled:false,message:'Returned instruction layout, route, or wallet accounts are not supported.'};}
 return {state:'unsupported',quote:q,inspection,signingEnabled:false,message:SOL_SWAP_BLOCKER};
}
