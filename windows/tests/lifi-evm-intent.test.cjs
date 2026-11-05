const {test,before}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process'),{Transaction,Wallet,ZeroAddress}=require('ethers');
const {LIFI_EVM,LIFI_ROUTER,LIFI_FEE,ONE_INCH,LIFI_TOKEN,validateLifiEvm,lifiEvmFingerprint,verifyLifiEvmResponse}=require('../dist/lifi-evm.cjs'),fixtures=require('./fixtures/lifi-oneinch.json');
let vault;const password='Only a local fixture. Never fund this vault!';
function worker(j){const p=spawnSync(process.execPath,['--no-addons','--require','./tests/offline-network-deny.cjs','dist/worker.cjs'],{input:JSON.stringify(j),encoding:'utf8',windowsHide:true});if(p.status===90)throw Error('Offline signing attempted networking.');const r=JSON.parse(p.stdout);if(!r.ok)throw Error(r.error);return r.result;}
before(()=>vault=worker({action:'create',password}));
function request(index=0,action='swap'){
 const q=fixtures.cases[index].quote,now=Date.now(),minimum=(BigInt(q.estimate.toAmount)*9900n+9999n)/10000n,r={version:12,action,provider:'lifi-1inch',chain:'ethereum',network:'ethereum',requestId:randomUUID(),deviceId:vault.public.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from:vault.public.evmAddress,recipient:vault.public.evmAddress,tokenIn:index===0?'ETH':'USDC',tokenOut:index===0?'USDC':'ETH',amount:action==='revoke'?'0':q.action.fromAmount,quotedOutput:action==='swap'?q.estimate.toAmount:'0',minimumOutput:action==='swap'?minimum.toString():'0',slippageBps:action==='swap'?100:0,protocolFee:action==='swap'?q.estimate.feeCosts[0].amount:'0',transactionId:LIFI_ROUTER.parseTransaction({data:q.transactionRequest.data}).args.transactionId,maximumFee:'60000000000000'};
 let data;if(action==='swap'){
  // Explicit synthetic re-encoding for integer-slippage and fixture wallet tests.
  // The original API payload remains in the fixture and is never counted executed.
  const c=LIFI_ROUTER.parseTransaction({data:q.transactionRequest.data}),a=c.args.toArray(true);a[3]=r.recipient;a[4]=minimum;a[5][0][0]=a[5][0][1]=LIFI_EVM.feeForwarder.address;const i=ONE_INCH.parseTransaction({data:a[5][1][5]}),inner=i.args.toArray(true);inner[1][5]=minimum;a[5][1][5]=ONE_INCH.encodeFunctionData(i.fragment,inner);data=LIFI_ROUTER.encodeFunctionData(c.fragment,a);
 }else data=LIFI_TOKEN.encodeFunctionData('approve',[LIFI_EVM.diamond.address,r.amount]);
 r.unsignedTransaction=Transaction.from({type:2,chainId:1,nonce:0,to:action==='swap'?LIFI_EVM.diamond.address:require('../dist/payment.cjs').CHAINS.ethereum.usdc,data,value:action==='swap'&&index===0?r.amount:0,gasLimit:300000,maxFeePerGas:200000000,maxPriorityFeePerGas:100000000}).unsignedSerialized;r.fingerprint=lifiEvmFingerprint(r);return r;
}
function mutated(r,change){const tx=Transaction.from(r.unsignedTransaction),c=LIFI_ROUTER.parseTransaction({data:tx.data}),a=c.args.toArray(true);change(a);tx.data=LIFI_ROUTER.encodeFunctionData(c.fragment,a);const b={...r,unsignedTransaction:tx.unsignedSerialized};b.fingerprint=lifiEvmFingerprint(b);return b;}
test('Legacy fee forwarding is readable after cutover and cannot be signed anew',async()=>{
 const {LEGACY_LIFI_FEE_FORWARDER,lifiEvmApproval}=require('../dist/lifi-evm.cjs');
 const {historicalReview}=require('../ui-routes-main.cjs');
 const now=Date.now();
 const current=request();
 const legacy=mutated(current,a=>a[5][0][0]=a[5][0][1]=LEGACY_LIFI_FEE_FORWARDER.address);
 assert.throws(()=>validateLifiEvm(legacy,now),/fee forwarder/);
 assert.throws(()=>worker({action:'sign',vault,password,request:legacy,fingerprint:legacy.fingerprint}));
 assert.equal(historicalReview(legacy,()=>undefined).fingerprint,legacy.fingerprint);
 const synthetic=Wallet.createRandom();
 const unsigned=mutated({...legacy,from:synthetic.address,recipient:synthetic.address},a=>a[3]=synthetic.address);
 const signed=await synthetic.signTransaction(Transaction.from(unsigned.unsignedTransaction));
 const approvalSignature=await synthetic.signMessage(lifiEvmApproval(unsigned));
 const response={version:12,deviceId:unsigned.deviceId,requestId:unsigned.requestId,fingerprint:unsigned.fingerprint,signedAt:new Date(now).toISOString(),rawSignedTransaction:signed,transactionHash:Transaction.from(signed).hash,approvalSignature};
 assert.equal(verifyLifiEvmResponse(response,unsigned,{deviceId:unsigned.deviceId,evmAddress:synthetic.address},Date.parse(unsigned.expiresAt)+1,false).transactionHash,response.transactionHash);
 for(const wrong of [LEGACY_LIFI_FEE_FORWARDER.address,ZeroAddress]){
  const mixed=mutated(current,a=>a[5][0][1]=wrong);
  assert.throws(()=>validateLifiEvm(mixed,now,false),/permission/);
 }
});
test('application worker reviews, signs, verifies and recovers both LI.FI directions and exact approvals offline',()=>{
 for(const [i,action]of [[0,'swap'],[1,'swap'],[1,'approve'],[1,'revoke']]){const r=request(i,action);validateLifiEvm(r);const review=worker({action:'review',vault,request:r});assert.equal(review.spender,LIFI_EVM.diamond.address);const s=worker({action:'sign',vault,password,request:r,fingerprint:r.fingerprint});assert.equal(verifyLifiEvmResponse(s,r,vault.public).transactionHash,s.transactionHash);assert.equal(worker({action:'verify-saved',vault,request:r,response:s}).response.transactionHash,s.transactionHash);assert.throws(()=>verifyLifiEvmResponse(s,r,vault.public,Date.parse(r.expiresAt)+1));verifyLifiEvmResponse(s,r,vault.public,Date.parse(r.expiresAt)+1,false);}
});
test('LI.FI rejects substituted outer/inner recipients, extra operations, fee theft and expanded wallet permissions',()=>{
 const r=request();for(const change of [a=>a[3]=Wallet.createRandom().address,a=>a[4]=0n,a=>a[1]='untrusted',a=>a[5].push(a[5][1]),a=>a[5][1][1]=Wallet.createRandom().address,a=>a[5][1][6]=true,a=>a[5][0][0]=Wallet.createRandom().address,a=>{const f=LIFI_FEE.parseTransaction({data:a[5][0][5]}),args=f.args.toArray(true);args[0][0][0]=Wallet.createRandom().address;a[5][0][5]=LIFI_FEE.encodeFunctionData(f.fragment,args);},...['executor','dstReceiver','srcReceiver','flags','amount','minReturnAmount'].map(field=>a=>{const c=ONE_INCH.parseTransaction({data:a[5][1][5]}),v=c.args.toArray(true),indexes={srcReceiver:2,dstReceiver:3,amount:4,minReturnAmount:5,flags:6};if(field==='executor')v[0]=Wallet.createRandom().address;else v[1][indexes[field]]=field.endsWith('Receiver')?Wallet.createRandom().address:field==='flags'?4n:0n;a[5][1][5]=ONE_INCH.encodeFunctionData(c.fragment,v);})])assert.throws(()=>validateLifiEvm(mutated(r,change)));
 const approval=request(1,'approve'),tx=Transaction.from(approval.unsignedTransaction);tx.data=LIFI_TOKEN.encodeFunctionData('approve',[LIFI_EVM.diamond.address,2n**256n-1n]);const bad={...approval,unsignedTransaction:tx.unsignedSerialized};bad.fingerprint=lifiEvmFingerprint(bad);assert.throws(()=>validateLifiEvm(bad));
});
test('LI.FI rejects wrong chain, token, stale clock, wallet switching, signature replay and noncanonical payloads',()=>{
 const r=request(),s=worker({action:'sign',vault,password,request:r,fingerprint:r.fingerprint});assert.throws(()=>verifyLifiEvmResponse(s,r,{...vault.public,evmAddress:Wallet.createRandom().address}));assert.throws(()=>verifyLifiEvmResponse({...s,requestId:randomUUID()},r,vault.public));assert.throws(()=>validateLifiEvm(r,Date.parse(r.expiresAt)));
 for(const change of [{chain:'sepolia'},{tokenOut:'ETH'},{minimumOutput:'1'},{from:ZeroAddress}]){const bad={...r,...change};bad.fingerprint=lifiEvmFingerprint(bad);assert.throws(()=>validateLifiEvm(bad));}
 const tx=Transaction.from(r.unsignedTransaction);tx.data+='00';const bad={...r,unsignedTransaction:tx.unsignedSerialized};bad.fingerprint=lifiEvmFingerprint(bad);assert.throws(()=>validateLifiEvm(bad),/noncanonical/);
});
