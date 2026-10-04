// Shared offline/online protocol. No API key, network access or provider execution.
import {z} from 'zod';
import {getAddress,keccak256,Transaction,verifyMessage,formatUnits} from 'ethers';
import {boundTradeSchema,validateTrade,tradeReview,ETH_TOKENS} from './trade-protocol';
import {multiPublicSchema} from './multi-protocol';

const quantity=z.string().max(39).regex(/^(0|[1-9][0-9]*)$/).refine(v=>BigInt(v)<2n**128n);
const address=z.string().refine(v=>{try{return getAddress(v)!=='0x0000000000000000000000000000000000000000';}catch{return false;}});
const digest=z.string().regex(/^0x[0-9a-f]{64}$/);
export const husherDepositTermsSchema=z.object({
 provider:z.literal('husher'),orderType:z.literal('normal'),fixedRate:z.literal(true),privacy:z.literal(false),
 orderId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),externalUserId:z.string().regex(/^drivekey-[0-9a-f-]{36}$/),
 network:z.literal('ethereum'),chainId:z.literal(1),sendAsset:z.literal('ETH'),receiveAsset:z.literal('USDC'),
 receiveContract:z.literal(ETH_TOKENS.USDC.address),receiveDecimals:z.literal(6),
 depositAddress:address,payoutAddress:address,refundAddress:address,
 sendBaseUnits:quantity,exactReceiveBaseUnits:quantity,providerFeeBaseUnits:quantity,withdrawalFeeBaseUnits:quantity,maximumProviderFeeBaseUnits:quantity,
 depositDeadline:z.string().datetime(),rateLockExpiresAt:z.string().datetime(),orderExpiresAt:z.string().datetime(),
}).strict();
export const husherDepositSchema=z.object({version:z.literal(8),kind:z.literal('provider-deposit'),
 payment:boundTradeSchema,terms:husherDepositTermsSchema,fingerprint:digest}).strict();
export type HusherDepositRequest=z.infer<typeof husherDepositSchema>;
export const husherDepositResponseSchema=z.object({version:z.literal(8),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:digest,
 signedAt:z.string().datetime(),rawSignedTransaction:z.string().regex(/^0x[0-9a-f]+$/).max(8192),approvalSignature:z.string().max(132),transactionHash:digest}).strict();

// Canonical recursively sorted data binds every provider and payment field, including inner fingerprint.
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
 return value;
}
export function husherDepositFingerprint(r:Omit<HusherDepositRequest,'fingerprint'>|HusherDepositRequest){
 return keccak256(new TextEncoder().encode(JSON.stringify(['DriveKey provider deposit v8',canonical({version:r.version,kind:r.kind,payment:r.payment,terms:r.terms})])));
}
export function husherDepositApproval(r:HusherDepositRequest){return 'DriveKey provider deposit approval v8\n'+r.fingerprint;}
export function validateHusherDeposit(input:unknown,now=Date.now(),checkExpiry=true):HusherDepositRequest{
 const r=husherDepositSchema.parse(input),p=validateTrade(r.payment,now,checkExpiry),t=r.terms;
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid clock.');
 if(p.kind!=='payment'||p.tokenIn!=='ETH'||p.amount!==t.sendBaseUnits||getAddress(p.recipient)!==getAddress(t.depositAddress))throw Error('Provider deposit differs from payment.');
 if(getAddress(t.refundAddress)!==getAddress(p.from))throw Error('Refund must return to the signing wallet.');
 if([p.from,t.payoutAddress,t.refundAddress].some(a=>getAddress(a)===getAddress(t.depositAddress)))throw Error('Provider deposit address cannot be the payout or wallet address.');
 if(BigInt(t.exactReceiveBaseUnits)<=0n||BigInt(t.providerFeeBaseUnits)+BigInt(t.withdrawalFeeBaseUnits)>BigInt(t.maximumProviderFeeBaseUnits))throw Error('Invalid provider payout or fee cap.');
 const expires=Date.parse(p.expiresAt),created=Date.parse(p.createdAt);
 for(const deadline of [t.depositDeadline,t.rateLockExpiresAt,t.orderExpiresAt])if(Date.parse(deadline)<=created||expires>Date.parse(deadline))throw Error('Payment outlives provider terms.');
 if(Date.parse(t.rateLockExpiresAt)>Date.parse(t.orderExpiresAt)||Date.parse(t.depositDeadline)>Date.parse(t.orderExpiresAt))throw Error('Inconsistent provider deadlines.');
 if(husherDepositFingerprint(r)!==r.fingerprint)throw Error('Provider request fingerprint mismatch.');
 return r;
}
export function verifyHusherDepositResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),checkExpiry=true){
 const r=validateHusherDeposit(request,now,checkExpiry),p=r.payment,w=multiPublicSchema.parse(wallet),s=husherDepositResponseSchema.parse(input),tx=Transaction.from(s.rawSignedTransaction);
 if(p.deviceId!==w.deviceId||getAddress(p.from)!==getAddress(w.evmAddress)||s.deviceId!==p.deviceId||s.requestId!==p.requestId||s.fingerprint!==r.fingerprint||tx.unsignedSerialized!==p.unsignedTransaction||tx.from!==getAddress(w.evmAddress)||tx.hash!==s.transactionHash||getAddress(verifyMessage(husherDepositApproval(r),s.approvalSignature))!==getAddress(w.evmAddress))throw Error('Response does not match provider-bound approval.');
 if(Date.parse(s.signedAt)<Date.parse(p.createdAt)-60000||Date.parse(s.signedAt)>=Date.parse(p.expiresAt)||Date.parse(s.signedAt)>now+60000)throw Error('Invalid signing time.');
 return s;
}
export function husherDepositReview(input:unknown,checkExpiry=true){
 const r=validateHusherDeposit(input,Date.now(),checkExpiry),t=r.terms;
 return {...tradeReview(r.payment,checkExpiry),action:'provider-deposit',requiredSigner:'RC19 or later · provider approval version 8',
 provider:'Husher · standard fixed-rate exchange',privacy:'Not a verified privacy route',orderId:t.orderId,externalUserId:t.externalUserId,
 depositAddress:t.depositAddress,payoutAddress:t.payoutAddress,refundAddress:t.refundAddress,
 outputAsset:'USDC · Ethereum mainnet',outputContract:t.receiveContract,outputDecimals:String(t.receiveDecimals),
 exactPayout:formatUnits(t.exactReceiveBaseUnits,6)+' USDC',exactPayoutBaseUnits:t.exactReceiveBaseUnits,
 providerFee:formatUnits(t.providerFeeBaseUnits,6)+' USDC',withdrawalFee:formatUnits(t.withdrawalFeeBaseUnits,6)+' USDC',maximumProviderFees:formatUnits(t.maximumProviderFeeBaseUnits,6)+' USDC',
 depositDeadlineUTC:t.depositDeadline,rateLockExpiresUTC:t.rateLockExpiresAt,orderExpiresUTC:t.orderExpiresAt,
 paymentFingerprint:r.payment.fingerprint,fingerprint:r.fingerprint,
 warning:'Custodial exchange: the deposit transfers ETH to Husher. Payout, fees and refund are provider commitments, not atomic on-chain swap guarantees. This offline device cannot verify provider promises or settlement. Expiry cannot revoke signed bytes.'};
}
