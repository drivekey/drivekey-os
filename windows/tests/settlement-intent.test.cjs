const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Keypair}=require('@solana/web3.js'),bs58=require('bs58').default,nacl=require('tweetnacl');
const {CHAINS,solPayment,paymentFingerprint,paymentApproval}=require('../dist/payment.cjs'),{OnlineAdapter}=require('../dist/adapter.cjs');
function fixture(asset){
 const source=Keypair.generate(),recipient=Keypair.generate(),now=Date.now();
 const r={version:8,action:'payment',requestId:randomUUID(),deviceId:randomUUID(),chain:'solana',network:'solana',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),from:source.publicKey.toBase58(),recipient:recipient.publicKey.toBase58(),asset,amount:'1000',maximumFee:'5000',accountRent:asset==='USDC'?'2039280':'0',createRecipientAccount:asset==='USDC',blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000};
 const tx=solPayment(r);r.unsignedTransaction=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');r.fingerprint=paymentFingerprint(r);tx.sign(source);
 const s={version:8,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:tx.serialize().toString('base64'),transactionHash:bs58.encode(tx.signature),approvalSignature:bs58.encode(nacl.sign.detached(Buffer.from(paymentApproval(r)),source.secretKey))};
 const keys=tx.compileMessage().accountKeys,balances=keys.map(()=>0);const recipientIndex=keys.findIndex(k=>k.equals(recipient.publicKey));if(recipientIndex>=0)balances[recipientIndex]=1000;
 const target=require('@solana/spl-token').getAssociatedTokenAddressSync(new (require('@solana/web3.js').PublicKey)(CHAINS.solana.usdc),recipient.publicKey),targetIndex=keys.findIndex(k=>k.equals(target));
 const settled={slot:999,transaction:[s.rawSignedTransaction,'base64'],meta:{err:null,fee:5000,preBalances:keys.map(()=>0),postBalances:balances,preTokenBalances:[],postTokenBalances:asset==='USDC'?[{accountIndex:targetIndex,mint:CHAINS.solana.usdc,owner:r.recipient,uiTokenAmount:{decimals:6,amount:'1000'}}]:[]}};
 let statusOnly=false;const adapter=new OnlineAdapter({solana:'https://fixture.test'},async(_u,init)=>{const j=JSON.parse(init.body);const result=j.method==='getGenesisHash'?CHAINS.solana.genesis:j.method==='getSignatureStatuses'?{value:[{err:null,confirmationStatus:'finalized',slot:999}]}:j.method==='getTransaction'?(statusOnly?null:settled):null;return {jsonrpc:'2.0',id:j.id,result};});
 return {r,s,settled,adapter,setStatusOnly:()=>statusOnly=true};
}
test('finalized status alone and changed signed bytes cannot qualify a Solana payment',async()=>{
 const f=fixture('SOL');assert.equal((await f.adapter.reconcile(f.r,f.s)).state,'confirmed');f.setStatusOnly();await assert.rejects(()=>f.adapter.reconcile(f.r,f.s),/evidence/);
 const g=fixture('SOL');g.settled.transaction[0]='changed';await assert.rejects(()=>g.adapter.reconcile(g.r,g.s),/differs/);
 const h=fixture('SOL');h.settled.meta.postBalances.fill(0);await assert.rejects(()=>h.adapter.reconcile(h.r,h.s),/credit/);
});
test('Solana USDC settlement requires canonical mint, exact credit, six decimals and recipient ownership',async()=>{
 const f=fixture('USDC');assert.equal((await f.adapter.reconcile(f.r,f.s)).state,'confirmed');
 for(const change of [{owner:Keypair.generate().publicKey.toBase58()},{mint:Keypair.generate().publicKey.toBase58()},{uiTokenAmount:{decimals:9,amount:'1000'}},{uiTokenAmount:{decimals:6,amount:'999'}}]){const g=fixture('USDC');Object.assign(g.settled.meta.postTokenBalances[0],change);await assert.rejects(()=>g.adapter.reconcile(g.r,g.s),/ownership|credit/);}
});
test('public broadcast adapter rejects a changed signed intent before any RPC submission',async()=>{
 const f=fixture('SOL');await assert.rejects(()=>f.adapter.broadcast(f.r,{...f.s,transactionHash:bs58.encode(Buffer.alloc(64))}),/differs/);
});
