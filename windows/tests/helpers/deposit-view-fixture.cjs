'use strict';
// Shape-valid unsigned instructions only. Ciphertext is copied from a public
// historical fixture, so these packets are never eligible for real signing.
const {randomUUID}=require('node:crypto');
const {PublicKey,VersionedTransaction,TransactionMessage,TransactionInstruction}=require('@solana/web3.js');
const sol=require('../../dist/hinkal-solana.cjs');
function depositRequest(wallet,asset='SOL',amount='1',now=Date.now()){
 const p=require('../fixtures/hinkal-solana-deposit.json').result;
 const old=TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(p.unsignedTransaction,'base64')).message).instructions[0];
 const decoded=sol.HINKAL_SOLANA_CODER.decode(old.data);decoded.data.amounts[0]=new decoded.data.amounts[0].constructor(amount);
 const from=wallet.solanaAddress,accounts=sol.hinkalSolanaAccounts(from,asset,p.merkleMIndex);
 const ix=new TransactionInstruction({programId:new PublicKey(sol.HINKAL_SOLANA.program),keys:accounts.expected.map((address,i)=>({pubkey:new PublicKey(address),isSigner:address===from,isWritable:[0,2,3,7,8,...(asset==='USDC'?[5,6]:[])].includes(i)})),data:sol.HINKAL_SOLANA_CODER.encode(decoded.name,decoded.data)});
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(from),recentBlockhash:p.blockhash,instructions:[ix]}).compileToLegacyMessage());
 const r={version:14,provider:'hinkal',action:'hinkal-deposit',network:'solana',chain:'solana',requestId:randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from,recipient:from,asset,amount,maximumFee:'5000',accountRent:asset==='USDC'?'2039280':'0',blockhash:p.blockhash,lastValidBlockHeight:p.lastValidBlockHeight,merkleMIndex:p.merkleMIndex,programDataSha256:sol.HINKAL_SOLANA.pin.programDataSha256,unsignedTransaction:Buffer.from(tx.serialize()).toString('base64')};r.fingerprint=sol.hinkalSolanaFingerprint(r);return sol.validateHinkalSolana(r);
}
const depositDependencies={plan:async input=>({asset:input.asset,amount:input.amount}),adapter:{prepare:async(plan,wallet,now)=>depositRequest(wallet,plan.asset,plan.amount,now)}};
module.exports={depositRequest,depositDependencies};
