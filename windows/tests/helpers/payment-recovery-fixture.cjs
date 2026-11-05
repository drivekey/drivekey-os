'use strict';
// Fresh unfunded controlled-recipient payment signed by the real offline worker. No RPC, native
// approval, funding or broadcast. Unlock data never leaves this helper.
const {randomBytes,randomUUID}=require('node:crypto'),{Transaction}=require('ethers');
const {child}=require('./hinkal-proof-session.cjs'),{paymentFingerprint}=require('../../dist/payment.cjs');
function paymentRecoveryFixture(){
 const password=randomBytes(48).toString('base64'),vault=child('worker.cjs',{action:'create',password}),recipientVault=child('worker.cjs',{action:'create',password}),now=Date.now();
 const request={version:8,action:'payment',requestId:randomUUID(),deviceId:vault.public.deviceId,chain:'ethereum',network:'ethereum',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from:vault.public.evmAddress,recipient:recipientVault.public.evmAddress,asset:'ETH',amount:'1',maximumFee:'21000',accountRent:'0',createRecipientAccount:false,blockhash:null,lastValidBlockHeight:null,
  unsignedTransaction:Transaction.from({type:2,chainId:1,nonce:0,to:recipientVault.public.evmAddress,value:1n,gasLimit:21000n,maxFeePerGas:1n,maxPriorityFeePerGas:0n}).unsignedSerialized};
 request.fingerprint=paymentFingerprint(request);const response=child('worker.cjs',{action:'sign',vault,password,request,fingerprint:request.fingerprint});return {vault,recipientVault,request,response};
}
module.exports={paymentRecoveryFixture};
