const {test,before}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Wallet,Transaction,parseUnits}=require('ethers'),{Keypair,SystemProgram}=require('@solana/web3.js');
const {CHAINS,paymentFingerprint,validatePayment,verifyPaymentResponse,solPayment}=require('../dist/payment.cjs');
const {OnlineAdapter}=require('../dist/adapter.cjs');
const esbuild=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path');
let signer,vault;const pass='Disposable locally generated test credential 2026!',now=Date.now();
before(async()=>{const out=await esbuild.build({stdin:{contents:"export * from './signer';",resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});const file=path.resolve(__dirname,'../../../work/payment-signer.cjs');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,out.outputFiles[0].contents);signer=require(file);vault=await signer.createVault(pass);});
function intent(chain='sepolia',asset='ETH'){
 const c=CHAINS[chain],sol=c.family==='solana';const r={version:8,action:'payment',requestId:randomUUID(),deviceId:vault.public.deviceId,network:c.family,chain,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),from:sol?vault.public.solanaAddress:vault.public.evmAddress,recipient:sol?Keypair.generate().publicKey.toBase58():Wallet.createRandom().address,asset,amount:'1000',maximumFee:sol?'5000':'42000000000000',accountRent:'0',createRecipientAccount:false,blockhash:sol?Keypair.generate().publicKey.toBase58():null,lastValidBlockHeight:sol?900:null};
 if(sol)r.unsignedTransaction=solPayment(r).serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');else r.unsignedTransaction=Transaction.from({type:2,chainId:c.chainId,nonce:0,to:asset==='ETH'?r.recipient:c.usdc,value:asset==='ETH'?1000n:0n,data:asset==='ETH'?'0x':require('../dist/payment.cjs').ERC20_PAYMENT.encodeFunctionData('transfer',[r.recipient,1000n]),gasLimit:21000,maxFeePerGas:2000000000n,maxPriorityFeePerGas:1000000000n}).unsignedSerialized;
 r.fingerprint=paymentFingerprint(r);return r;
}
test('real V8 ETH, Ethereum USDC, SOL and Solana USDC signatures bind exact intent and survive deadline only for recovery',async()=>{
 for(const [chain,asset]of [['ethereum','ETH'],['sepolia','USDC'],['solana','SOL'],['devnet','USDC']]){
  const r=intent(chain,asset),review=signer.reviewRequest(r,vault,now),s=await signer.signReviewed(vault,pass,r,r.fingerprint,now);assert.equal(review.chain,chain);assert.equal(verifyPaymentResponse(s,r,vault.public,now).transactionHash,s.transactionHash);
  const late=Date.parse(r.expiresAt)+1;assert.equal(signer.verifySavedSignature(vault,r,s,late).applicationDeadlinePassed,true);await assert.rejects(()=>signer.signReviewed(vault,pass,r,r.fingerprint,late));
  assert.throws(()=>verifyPaymentResponse({...s,requestId:randomUUID()},r,vault.public,now));assert.throws(()=>verifyPaymentResponse(s,{...r,recipient:Wallet.createRandom().address},vault.public,now));
 }
});
test('independent decoder rejects altered recipient, unknown Solana program, signing permissions, chain, action and oversized allowance',()=>{
 const r=intent(),tx=Transaction.from(r.unsignedTransaction);tx.to=Wallet.createRandom().address;const altered={...r,unsignedTransaction:tx.unsignedSerialized};altered.fingerprint=paymentFingerprint(altered);assert.throws(()=>validatePayment(altered,now),/payload/);
 const s=intent('devnet','SOL'),st=solPayment(s);st.add(SystemProgram.assign({accountPubkey:Keypair.generate().publicKey,programId:SystemProgram.programId}));const extra={...s,unsignedTransaction:st.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')};extra.fingerprint=paymentFingerprint(extra);assert.throws(()=>validatePayment(extra,now),/unreviewed/);
 for(const change of [{action:'approval'},{chain:'devnet'},{maximumFee:'9999999999999999999999999999999999'},{recipient:'0x'+'0'.repeat(40)},{unexpected:true}]){const bad={...r,...change};bad.fingerprint=paymentFingerprint(bad);assert.throws(()=>validatePayment(bad,now));}
 assert.throws(()=>signer.reviewRequest({...r,deviceId:randomUUID()},vault,now));
});
test('online adapter rejects malformed RPC envelopes, wrong chain and secret-bearing request shape',async()=>{
 const transport=async(_u,init)=>{const j=JSON.parse(init.body);return {jsonrpc:'2.0',id:j.id,result:'0x89'};};const a=new OnlineAdapter({sepolia:'http://localhost:8545'},transport);await assert.rejects(()=>a.identity('sepolia'),/identity/);
 const bad=new OnlineAdapter({sepolia:'https://example.com'},async()=>({result:'0x1'}));await assert.rejects(()=>bad.identity('sepolia'),/malformed/);
 assert.throws(()=>new OnlineAdapter({sepolia:'http://evil.example'}));await assert.rejects(()=>a.prepare({chain:'sepolia',asset:'ETH',recipient:Wallet.createRandom().address,amount:'1',privateKey:'forbidden'},vault.public));
});
test('nonce conflict, uncertain broadcast, finalized receipt, reorg and Solana expiry are distinct without replacement signing',async()=>{
 const r=intent(),s=await signer.signReviewed(vault,pass,r,r.fingerprint,now);let mode='missing';
 const a=new OnlineAdapter({sepolia:'https://example.com'},async(_u,init)=>{const j=JSON.parse(init.body);let result;switch(j.method){case 'eth_chainId':result='0xaa36a7';break;case 'eth_getTransactionReceipt':result=mode==='missing'||mode==='conflict'?null:{transactionHash:s.transactionHash,status:'0x1',blockNumber:'0x5',blockHash:'0x'+'a'.repeat(64),gasUsed:'0x5208',effectiveGasPrice:'0x1'};break;case 'eth_getTransactionByHash':result=mode==='final'?{hash:s.transactionHash,blockHash:'0x'+'a'.repeat(64),from:r.from,to:r.recipient,input:'0x',value:'0x3e8',nonce:'0x0',chainId:'0xaa36a7'}:null;break;case 'eth_getTransactionCount':result=mode==='conflict'?'0x1':'0x0';break;case 'eth_getBlockByNumber':result={number:'0x9',hash:'0x'+(mode==='reorg'?'b':'a').repeat(64)};break;default:throw Error(j.method);}return {jsonrpc:'2.0',id:j.id,result};});
 assert.equal((await a.reconcile(r,s)).state,'uncertain');mode='conflict';assert.equal((await a.reconcile(r,s)).state,'conflict');mode='final';assert.equal((await a.reconcile(r,s)).state,'confirmed');mode='reorg';assert.equal((await a.reconcile(r,s)).state,'uncertain');
 const sr=intent('devnet','SOL'),ss=await signer.signReviewed(vault,pass,sr,sr.fingerprint,now),sol=new OnlineAdapter({devnet:'https://example.com'},async(_u,init)=>{const j=JSON.parse(init.body);return {jsonrpc:'2.0',id:j.id,result:j.method==='getGenesisHash'?CHAINS.devnet.genesis:j.method==='getSignatureStatuses'?{value:[null]}:1000};});assert.equal((await sol.reconcile(sr,ss)).state,'expired-unresolved');
});
test('pure JavaScript bigint conversion is bounded, lossless and rejects overflow',()=>{const shim=require('../vendor/bigint-buffer');for(const n of [0n,1n,255n,2n**64n-1n]){assert.equal(shim.toBigIntLE(shim.toBufferLE(n,8)),n);assert.equal(shim.toBigIntBE(shim.toBufferBE(n,8)),n);}assert.throws(()=>shim.toBufferBE(256n,1));assert.throws(()=>shim.toBufferBE(-1n,8));assert.throws(()=>shim.toBigIntBE(Buffer.alloc(1025)));});
