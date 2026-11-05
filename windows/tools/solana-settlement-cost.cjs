'use strict';
const {Transaction,PublicKey}=require('@solana/web3.js'),{getAssociatedTokenAddressSync}=require('@solana/spl-token'),{cost}=require('./acceptance-policy.cjs');
const safe=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Unsafe Solana metadata amount.');return BigInt(n);};
function solanaSettlementCost(request,response,observations,valuation){
 const {verifyPaymentResponse,CHAINS}=require('../dist/payment.cjs'),r=request;verifyPaymentResponse(response,r,{deviceId:r.deviceId,solanaAddress:r.from},Date.now(),false);
 if(r.network!=='solana'||r.version!==8||observations.length!==2||new Set(observations.map(o=>o.endpoint)).size!==2)throw Error('Independent Solana payment observations required.');
 const [a,b]=observations.map(o=>{if(o.state!=='confirmed'||o.transactionHash!==response.transactionHash||o.receipt?.meta?.err!==null||o.receipt.transaction?.[0]!==response.rawSignedTransaction||o.receipt.transaction?.[1]!=='base64')throw Error('Finalized Solana signature/bytes mismatch.');return o.receipt;});
 const {canonical}=require('../dist/payment.cjs'),fields=['slot','blockTime','meta'];for(const f of fields)if(canonical(a[f])!==canonical(b[f]))throw Error('Independent Solana metadata disagreement.');safe(a.slot);
 const keys=Transaction.from(Buffer.from(response.rawSignedTransaction,'base64')).compileMessage().accountKeys,index=s=>keys.findIndex(k=>k.toBase58()===s),sender=index(r.from);if(sender!==0)throw Error('Solana fee payer differs from controlled source.');
 const fee=safe(a.meta.fee);if(fee>BigInt(r.maximumFee))throw Error('Solana fee exceeds signed maximum.');let rent=0n;
 if(r.asset==='USDC'){
  const mint=new PublicKey(CHAINS[r.chain].usdc),target=index(getAssociatedTokenAddressSync(mint,new PublicKey(r.recipient)).toBase58()),source=index(getAssociatedTokenAddressSync(mint,new PublicKey(r.from)).toBase58());
  if(target<0||source<0)throw Error('Canonical token accounts absent.');
  const check=(list,i,owner,optional=false)=>{const entry=list?.find(t=>t.accountIndex===i);if(!entry&&optional)return 0n;if(!entry||entry.owner!==owner||entry.mint!==mint.toBase58()||entry.uiTokenAmount?.decimals!==6||!/^(0|[1-9][0-9]*)$/.test(entry.uiTokenAmount.amount))throw Error('Solana token account ownership, mint or decimals differ.');return BigInt(entry.uiTokenAmount.amount);};
  if(check(a.meta.preTokenBalances,source,r.from)-check(a.meta.postTokenBalances,source,r.from)!==BigInt(r.amount)||check(a.meta.postTokenBalances,target,r.recipient)-check(a.meta.preTokenBalances,target,r.recipient,r.createRecipientAccount)!==BigInt(r.amount))throw Error('Solana exact token debit/credit mismatch.');
  const before=safe(a.meta.preBalances[target]),after=safe(a.meta.postBalances[target]);rent=after-before;if(rent<0n||rent>BigInt(r.accountRent)||(!r.createRecipientAccount&&rent!==0n)||(rent>0n&&before!==0n))throw Error('Solana actual rent differs from approval.');
 }else{const target=index(r.recipient);if(target<0||safe(a.meta.postBalances[target])-safe(a.meta.preBalances[target])!==BigInt(r.amount))throw Error('Solana native recipient credit differs.');}
 const nativeDebit=safe(a.meta.preBalances[sender])-safe(a.meta.postBalances[sender]);if(nativeDebit!==fee+rent+(r.asset==='SOL'?BigInt(r.amount):0n))throw Error('Solana source debit differs from authorized fee, rent and amount.');
 return {actualFeeBaseUnits:fee.toString(),actualRentBaseUnits:rent.toString(),actualUsdMicros:(cost(r.amount,valuation.assetUsdMicros,r.asset==='USDC'?6:9)+cost((fee+rent).toString(),valuation.nativeUsdMicros,9)).toString(),slot:a.slot};
}
module.exports={solanaSettlementCost};
