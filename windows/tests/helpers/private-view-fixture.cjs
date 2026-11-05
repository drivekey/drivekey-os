'use strict';
// Fresh unfunded identity. No network, financial transaction or protected data.
const {randomBytes,randomUUID}=require('node:crypto');
const {child}=require('./hinkal-proof-session.cjs');
const core=require('../../dist/hinkal-view.cjs'),transport=require('../../dist/hinkal-view-crypto.cjs');
async function privateViewFixture(chain='ethereum',existing){
 const password=existing?.password||randomBytes(48).toString('base64'),vault=existing?.vault||child('worker.cjs',{action:'create',password}),pair=transport.createViewTransport(),now=Date.now();
 const context={testOnly:true,chain,action:chain==='ethereum'?'deposit':'withdraw',asset:chain==='ethereum'?'ETH':'SOL',amount:'1',from:chain==='ethereum'?vault.public.evmAddress:vault.public.solanaAddress,recipient:chain==='ethereum'?vault.public.evmAddress:vault.public.solanaAddress,inputNotes:chain==='ethereum'?[]:['0x1234'],pendingLeaves:[]};
 const request={version:30,kind:'drivekey-hinkal-view-request',requestId:randomUUID(),deviceId:vault.public.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),wallet:vault.public,profile:chain==='ethereum'?13:15,context,nonce:chain==='ethereum'?0:null,maximumFee:chain==='ethereum'?'100000000000000':'5000',maximumAccountRent:'0',transportPublicKey:pair.transportPublicKey,fingerprint:''};request.fingerprint=core.viewFingerprint(request);
 const response=await require('../../dist/hinkal-view-signer.cjs').authorizePrivateView(vault,password,request,request.fingerprint);return {vault,password,request,response,pair};
}
function providerDouble(profile,input){return {version:1,kind:profile===13?'hinkal-unsigned-proof-job':'hinkal-solana-unsigned-proof-job',context:input.context,request:{messageSeed:'1'},response:{jobId:'explicit-provider-double'},proofAuthorized:false,blockchainTransactionSigned:false,submitted:false};}
module.exports={privateViewFixture,providerDouble};
