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
export function paymentLink(input:unknown){return APP_ORIGIN+'/app/send#request='+encodeURIComponent(JSON.stringify(validatePaymentRequest(input)));}
export function parsePaymentLink(text:string){
 if(text.length>2048)throw Error('Payment request too large.');
 const u=new URL(text);
 if(!approvedAppOrigin(u.origin)||!['/send','/app/send'].includes(u.pathname)||u.search||u.username||u.password||!u.hash.startsWith('#request='))throw Error('Not a DriveKey payment request.');
 return validatePaymentRequest(JSON.parse(decodeURIComponent(u.hash.slice(9))));
}
export const SOL_USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Validate display evidence; network verification still belongs to paymentReceipt. */
export function paymentReceiptMessage(input:unknown,hash:string,ok:boolean,value:unknown):string {
 if(!ok)throw Error('Receipt unavailable. Nothing was submitted.');
 const request=validatePaymentRequest(input);
 if(!(request.network==='solana'?/^[1-9A-HJ-NP-Za-km-z]{80,90}$/:/^0x[0-9a-fA-F]{64}$/).test(hash))throw Error('Invalid receipt identity.');
 const result=z.object({state:z.enum(['pending','failed','mismatch','confirmed']),message:z.string().min(1).max(512),finality:z.enum(['confirmed','finalized']).optional(),amount:z.string().regex(/^[1-9][0-9]{0,77}$/).optional(),hash:z.string().max(90).optional()}).strict().parse(value);
 const sameHash=(a:string,b:string)=>request.network==='solana'?a===b:a.toLowerCase()===b.toLowerCase();
 if(result.hash!==undefined&&!sameHash(result.hash,hash))throw Error('Receipt identity mismatch.');
 if(result.state==='confirmed'){
  if(!result.hash||!result.amount||!sameHash(result.hash,hash)||(request.network!=='solana'&&result.finality!=='finalized')||result.finality==='confirmed')throw Error('Incomplete finalized receipt.');
  if(request.amount!==undefined&&BigInt(result.amount)!==parseUnits(request.amount,request.asset==='USDC'?6:request.asset==='SOL'?9:18))throw Error('Receipt amount mismatch.');
  return 'Payment confirmed. Matching finalized transfer. Do not reuse this receipt for another request.';
 }
 return {pending:'Payment pending. No finalized matching receipt yet.',failed:'Payment failed. No successful transfer verified.',mismatch:'Payment does not match this request.'}[result.state];
}
