'use strict';
// Historical public deposit proof + newly assembled UNSIGNED transaction only.
// The original authorization timestamps are unchanged. Never signs/broadcasts.
const {randomUUID}=require('node:crypto'),{Transaction}=require('ethers');
const document=require('../fixtures/provider-ethereum-deposit.json').package,{HINKAL_PIN,hinkalFingerprint,validateHinkal}=require('../../dist/hinkal.cjs');
const now=Date.parse(document.result.createdAt)+1000;
function providerChainRequest(){const s=document.request.seed,c=s.job.context,r={version:10,provider:'hinkal',action:'hinkal-'+c.action,network:'ethereum',chain:'ethereum',requestId:randomUUID(),deviceId:s.deviceId,createdAt:new Date(now).toISOString(),expiresAt:document.request.expiresAt,from:c.from,recipient:c.recipient,asset:c.asset,amount:c.amount,maximumFee:'75000000000000',contractCodeHash:HINKAL_PIN.ethereumCodeHash,inputNotes:c.inputNotes,unsignedTransaction:Transaction.from({type:2,chainId:1,nonce:s.nonce,to:document.result.proof.transaction.to,value:document.result.proof.transaction.value,data:document.result.proof.transaction.data,gasLimit:75000n,maxFeePerGas:1000000000n,maxPriorityFeePerGas:0n}).unsignedSerialized,fingerprint:''};r.fingerprint=hinkalFingerprint(r);return validateHinkal(r,now,false);}
module.exports={document,now,providerChainRequest};
