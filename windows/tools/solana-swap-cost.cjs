'use strict';
const {lifiSolanaSettlement}=require('../dist/lifi-solana-settlement.cjs'),{canonical}=require('../dist/payment.cjs'),{cost}=require('./acceptance-policy.cjs');
function solanaSwapCost(r,response,observations,valuation){
 if(!Array.isArray(observations)||observations.length!==2||new Set(observations.map(o=>o.endpoint)).size!==2||observations.some(o=>o.state!=='confirmed'||o.transactionHash!==response.transactionHash||!o.receipt))throw Error('Two independent finalized Solana swap receipts required.');
 const [a,b]=observations.map(o=>o.receipt);if(a.slot!==b.slot||a.blockTime!==b.blockTime||canonical(a.meta)!==canonical(b.meta)||canonical(a.transaction)!==canonical(b.transaction))throw Error('Independent Solana swap metadata disagreement.');
 const settled=lifiSolanaSettlement(r,response,a),actualUsdMicros=cost(r.amount,valuation.assetUsdMicros,r.tokenIn==='USDC'?6:9)+cost((BigInt(settled.actualFeeBaseUnits)+BigInt(settled.actualRentBaseUnits)).toString(),valuation.nativeUsdMicros,9);return {...settled,actualUsdMicros:actualUsdMicros.toString()};
}
module.exports={solanaSwapCost};
