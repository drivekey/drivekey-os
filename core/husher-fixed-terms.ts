import 'server-only';
import {createHash} from 'node:crypto';
import {getAddress,parseUnits} from 'ethers';
import {PublicKey} from '@solana/web3.js';
import {z} from 'zod';

const decimal=z.string().max(80).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const address=z.string().min(32).max(64);
const routes={
 'sol-usdc':{sendToken:'SOL',receiveToken:'USDC',network:'SOL',inputDecimals:9,outputDecimals:6},
 'usdc-sol':{sendToken:'USDC',receiveToken:'SOL',network:'SOL',inputDecimals:6,outputDecimals:9},
 'eth-usdc':{sendToken:'ETH',receiveToken:'USDC',network:'ETH',inputDecimals:18,outputDecimals:6},
} as const;
// This is a server-side inspection intent, NOT an accepted offline signing format.
export const husherFixedIntent=z.object({
 orderId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),route:z.enum(['sol-usdc','usdc-sol','eth-usdc']),
 depositAddress:address,recipient:address,refundAddress:address,sendAmount:decimal,
 exactReceiveAmount:decimal,maximumProviderFees:decimal,
 requiredWindowMs:z.number().int().positive().max(3600000),
}).strict();
const terms=z.object({
 id:z.string(),status:z.enum(['pending','confirmed','exchanging','withdraw','completed','expired','failed','refund']),
 provider:z.literal('husher'),fixedRate:z.literal(true),sendAddress:address,sendNetwork:z.string(),sendToken:z.string(),
 sendAmount:decimal,sendTag:z.string().nullish(),receiveToken:z.string(),receiveNetwork:z.string(),
 receiveAddress:address,receiveTag:z.string().nullish(),refundAddress:address,refundTag:z.string().nullish(),
 receiveAmount:decimal,feeAmount:decimal,networkFee:decimal,
 depositDeadline:z.string().datetime({offset:true}),rateLockExpiresAt:z.string().datetime({offset:true}),
 orderExpiresAt:z.string().datetime({offset:true}),
});
function units(value:string,decimals:number){
 const normalized=value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;
 const n=parseUnits(normalized,decimals);if(n>=2n**128n)throw Error('Amount too large');return n;
}
function canonical(value:string,network:string){
 if(network==='ETH'){const a=getAddress(value);if(/^0x0{40}$/i.test(a))throw Error('Zero address');return a;}
 const a=new PublicKey(value);if(a.toBase58()!==value||value==='11111111111111111111111111111111')throw Error('Invalid address');return value;
}
export function inspectFixedOrderTerms(input:unknown,raw:unknown,now:number){
 const a=husherFixedIntent.parse(input),t=terms.parse(raw),r=routes[a.route];
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid clock');
 const eq=(left:string,right:string)=>canonical(left,r.network)===canonical(right,r.network);
 if(t.id!==a.orderId||t.sendToken!==r.sendToken||t.receiveToken!==r.receiveToken||t.sendNetwork!==r.network||t.receiveNetwork!==r.network)throw Error('Wrong order or route');
 if(!eq(t.sendAddress,a.depositAddress)||!eq(t.receiveAddress,a.recipient)||!eq(t.refundAddress,a.refundAddress))throw Error('Address changed');
 if([t.sendTag,t.receiveTag,t.refundTag].some(tag=>tag!=null&&tag!==''))throw Error('Memo routes unsupported');
 const send=units(t.sendAmount,r.inputDecimals),receive=units(t.receiveAmount,r.outputDecimals);
 if(send<=0n||receive<=0n||send!==units(a.sendAmount,r.inputDecimals)||receive!==units(a.exactReceiveAmount,r.outputDecimals))throw Error('Exact amount changed');
 const fee=units(t.feeAmount,r.outputDecimals),withdrawal=units(t.networkFee,r.outputDecimals);
 if(fee+withdrawal>units(a.maximumProviderFees,r.outputDecimals))throw Error('Fee ceiling exceeded');
 const expires=Math.min(Date.parse(t.depositDeadline),Date.parse(t.rateLockExpiresAt),Date.parse(t.orderExpiresAt));
 const reviewWindowAvailable=t.status==='pending'&&expires-now>=a.requiredWindowMs;
 const context={provider:'husher' as const,orderType:'normal' as const,orderId:t.id,route:a.route,
  network:r.network,sendToken:r.sendToken,receiveToken:r.receiveToken,
  depositAddress:canonical(t.sendAddress,r.network),recipient:canonical(t.receiveAddress,r.network),refundAddress:canonical(t.refundAddress,r.network),
  sendBaseUnits:send.toString(),receiveBaseUnits:receive.toString(),feeBaseUnits:fee.toString(),withdrawalFeeBaseUnits:withdrawal.toString(),
  maximumProviderFeeBaseUnits:units(a.maximumProviderFees,r.outputDecimals).toString(),feeAsset:r.receiveToken,
  depositDeadline:t.depositDeadline,rateLockExpiresAt:t.rateLockExpiresAt,orderExpiresAt:t.orderExpiresAt};
 return {context,termsFingerprint:createHash('sha256').update(JSON.stringify(context)).digest('hex'),providerStatus:t.status,reviewWindowAvailable,
  termsMatched:true,canonicalAssetsVerified:false,ordersEnabled:false,signingEnabled:false,privacyEnabled:false,settlementVerified:false,
  notice:'Matched provider terms only. Requires verified asset identities, budget reconciliation, provider-bound offline approval and independent chain evidence.'};
}
