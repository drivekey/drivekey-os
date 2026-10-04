import {APP_ORIGIN,approvedAppOrigin} from './app-origin';
import { z } from 'zod';
import { getAddress, parseUnits } from 'ethers';
import { PublicKey } from '@solana/web3.js';
export const paymentRequestSchema=z.object({version:z.literal(1),network:z.enum(['ethereum','solana','robinhood']),asset:z.enum(['ETH','WETH','SOL','USDC']),recipient:z.string().max(64),amount:z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(78).optional()}).strict();
export type PaymentRequest=z.infer<typeof paymentRequestSchema>;
export function validatePaymentRequest(input:unknown):PaymentRequest {
 const p=paymentRequestSchema.parse(input);
 if(p.network==='ethereum'||p.network==='robinhood'){if(!(p.network==='robinhood'?['ETH']:['ETH','WETH','USDC']).includes(p.asset)||getAddress(p.recipient)==='0x0000000000000000000000000000000000000000')throw Error('Invalid Ethereum payment request.');p.recipient=getAddress(p.recipient);}
 else if(!['SOL','USDC'].includes(p.asset)||new PublicKey(p.recipient).toBase58()!==p.recipient||!PublicKey.isOnCurve(new PublicKey(p.recipient).toBytes()))throw Error('Invalid Solana wallet request.');
 if(p.amount!==undefined&&parseUnits(p.amount,p.asset==='USDC'?6:p.asset==='SOL'?9:18)<=0n)throw Error('Amount must be positive.');
 return p;
}
export function paymentLink(input:unknown){return APP_ORIGIN+'/send#request='+encodeURIComponent(JSON.stringify(validatePaymentRequest(input)));}
export function parsePaymentLink(text:string){
 if(text.length>2048)throw Error('Payment request too large.');
 const u=new URL(text);
 if(!approvedAppOrigin(u.origin)||u.pathname!=='/send'||u.search||u.username||u.password||!u.hash.startsWith('#request='))throw Error('Not a DriveKey payment request.');
 return validatePaymentRequest(JSON.parse(decodeURIComponent(u.hash.slice(9))));
}
export const SOL_USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
