import {z} from 'zod';
import type {HusherDepositRequest} from './husher-deposit-protocol';
const digest=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const response=z.object({
 state:z.enum(['exchange-pending','provider-terms-unavailable','refund-unverified','payout-pending','payout-failed','payout-confirmed','exchange-finalized']),
 privacyEnabled:z.literal(false),canResubmit:z.literal(false),exchangeSettlementVerified:z.boolean(),
 providerStatus:z.enum(['pending','confirmed','exchanging','withdraw','completed','expired','failed','refund']).optional(),
 deposit:z.object({hash:digest,state:z.enum(['unknown','submitted','confirmed','failed']),finality:z.enum(['unverified','pending','confirmed','finalized'])}),
 payout:z.unknown().optional(),
});
const finalPayout=z.object({state:z.literal('payout-finalized'),finality:z.literal('finalized'),settlementVerified:z.literal(true),hash:digest,blockHash:digest,logIndex:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),amount:z.string(),recipient:z.string(),contract:z.string()});
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
// This checks response consistency against the approved request. Independent
// chain verification remains the server's responsibility; booleans alone are
// insufficient to display settlement or write terminal local history.
export function husherRecoveryView(raw:unknown,request:HusherDepositRequest,hash:string){
 const result=response.parse(raw),deposit=result.deposit;
 if(!equal(deposit.hash,hash))throw Error('Deposit status identity mismatch.');
 if(['confirmed','failed'].includes(deposit.state)&&deposit.finality!=='finalized')throw Error('Deposit finality could not be verified.');
 if((result.state==='exchange-finalized')!==result.exchangeSettlementVerified)throw Error('Exchange settlement evidence is inconsistent.');
 if(result.exchangeSettlementVerified){
  if(result.providerStatus!==undefined&&result.providerStatus!=='completed')throw Error('Provider status conflicts with verified settlement.');
  const payout=finalPayout.parse(result.payout),terms=request.terms;
  if(deposit.state!=='confirmed'||deposit.finality!=='finalized'||equal(payout.hash,hash)||payout.amount!==terms.exactReceiveBaseUnits||!equal(payout.recipient,terms.payoutAddress)||!equal(payout.contract,terms.receiveContract))throw Error('Payout does not match the approved exchange.');
 }
 const message=result.exchangeSettlementVerified?'Exact USDC payout independently verified as finalized.':result.state==='refund-unverified'?'Provider reports a refund. Returned funds are not verified. Do not resend.':result.state==='provider-terms-unavailable'?'Provider fees are unavailable. Exchange settlement is not verified. Do not resend.':'Exchange settlement is not verified.';
 const providerNotice=!result.exchangeSettlementVerified&&result.providerStatus==='failed'?' Provider reports the order failed. This does not verify a refund. Do not resend.':!result.exchangeSettlementVerified&&result.providerStatus==='expired'?' Provider reports the order expired. Expiry does not revoke signed deposit bytes or verify a refund. Do not resend.':!result.exchangeSettlementVerified&&result.providerStatus==='completed'?' Provider reports completion, but settlement evidence is incomplete. Do not resend.':'';
 return {deposit,message:`Deposit: ${deposit.state} / ${deposit.finality}. ${message}${providerNotice}`};
}
