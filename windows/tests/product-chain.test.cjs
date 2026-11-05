'use strict';
// Unfunded synthetic owned notes/trees. No provider, native approval, funding,
// broadcast, physical separation or mainnet settlement is claimed here.
const {test,before}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const core=require('../dist/hinkal-product-chain.cjs');
const {admissionFixture}=require('./helpers/product-admission-fixture.cjs');
const {productProofFingerprint}=require('../dist/hinkal-product-proof.cjs');
const {hinkalEvmSwapFingerprint}=require('../dist/hinkal-evm-swap.cjs'),{hinkalSolanaSwapFingerprint}=require('../dist/hinkal-solana-swap.cjs');
const fixtures=[];
before(async()=>{for(const chain of ['ethereum','solana']){const f=await admissionFixture(chain),request=await core.createProductChain(f.document,f.wallet,f.chainRequest());fixtures.push({...f,request});}});
function fingerprint(r){r.fingerprint=core.productChainFingerprint(r);return r;}
function innerFingerprint(r){r.chainRequest.fingerprint=(r.chain==='ethereum'?hinkalEvmSwapFingerprint:hinkalSolanaSwapFingerprint)(r.chainRequest);return fingerprint(r);}
test('v29 retains exact proof package, inner bytes, narrower lifetime and independent review identity',async()=>{
 for(const f of fixtures){const r=await core.verifyProductChain(f.request,f.wallet),review=core.productChainReview(r);assert.deepEqual(r.package,f.document);assert.equal(r.expiresAt,f.document.request.expiresAt);assert.notEqual(r.fingerprint,r.chainRequest.fingerprint);assert.equal(review.fingerprint,r.fingerprint);assert.equal(review.productProofFingerprint,f.document.request.fingerprint);assert.equal(review.chainFingerprint,r.chainRequest.fingerprint);assert.equal(review.productApprovalDeadlineUTC,f.document.request.expiresAt);assert.equal(Object.hasOwn(review,'package'),false);assert.equal(Object.hasOwn(review,'chainRequest'),false);assert.ok(Buffer.byteLength(JSON.stringify(r))<64*1024);}
});
test('extending both inner and envelope deadlines cannot detach the outer approval',async()=>{
 for(const f of fixtures){const r=structuredClone(f.request);r.expiresAt=r.chainRequest.expiresAt=r.package.request.seed.expiresAt;innerFingerprint(r);assert.throws(()=>core.validateProductChain(r),/original approval/);await assert.rejects(core.verifyProductChain(r,f.wallet));}
});
test('changing and refingerprinting the outer deadline still requires its original wallet authorization',async()=>{
 for(const f of fixtures){const r=structuredClone(f.request);r.package.request.expiresAt=r.package.request.seed.expiresAt;r.package.request.fingerprint=productProofFingerprint(r.package.request);fingerprint(r);await assert.rejects(core.verifyProductChain(r,f.wallet));}
});
test('wrong devices, chains, addresses, wallet metadata and unknown envelope fields fail closed',async()=>{
 for(const f of fixtures){for(const change of [r=>r.deviceId=randomUUID(),r=>r.chain=r.chain==='ethereum'?'solana':'ethereum',r=>r.requestId=randomUUID(),r=>r.extra=true]){const r=structuredClone(f.request);change(r);fingerprint(r);await assert.rejects(core.verifyProductChain(r,f.wallet));}
  for(const wallet of [{...f.wallet,createdAt:new Date(0).toISOString()},{...f.wallet,deviceId:randomUUID()},{...f.wallet,evmAddress:'0x'+'11'.repeat(20)}])await assert.rejects(core.verifyProductChain(f.request,wallet));}
});
test('changed proof bytes are rejected even with a newly computed envelope fingerprint',async()=>{
 for(const f of fixtures){const r=structuredClone(f.request);if(r.chain==='ethereum')r.package.result.proof.data='0x'+'00'.repeat((r.package.result.proof.data.length-2)/2);else r.package.result.proof.solanaArgs.proofAArr[0]^=1;fingerprint(r);await assert.rejects(core.verifyProductChain(r,f.wallet));}
});
test('tampered fee, amount, recipient, unsigned bytes or inner approval cannot gain authority from envelope hashing',async()=>{
 for(const f of fixtures){for(const change of [r=>r.chainRequest.amount='1',r=>r.chainRequest.maximumFee='1',r=>r.chainRequest.unsignedTransaction='0x00',r=>r.chainRequest.proofAuthorization.S='1']){const r=structuredClone(f.request);change(r);innerFingerprint(r);await assert.rejects(core.verifyProductChain(r,f.wallet));}}
});
test('expired and wrong-fingerprint requests produce no signature while historical verification remains readable',async()=>{
 for(const f of fixtures){const later=Date.parse(f.request.expiresAt)+1;await assert.rejects(f.signEnvelope(f.request,f.request.fingerprint,later));await assert.rejects(f.signEnvelope(f.request,'0x'+'00'.repeat(32)),/review changed/);await core.verifyProductChain(f.request,f.wallet,later,false);assert.throws(()=>core.productChainReview(f.request,later));}
});
test('both chains sign the complete envelope and restart recovery preserves the exact original signed bytes',async()=>{
 for(const f of fixtures){f.signed=await f.signEnvelope(f.request);const s=await core.verifyProductChainResponse(f.signed,f.request,f.wallet),later=Date.parse(f.request.expiresAt)+1;assert.equal(s.version,29);assert.equal(s.fingerprint,f.request.fingerprint);assert.notEqual(s.approvalSignature,s.innerApprovalSignature);await core.verifyProductChainResponse(s,f.request,f.wallet,later,false);await assert.rejects(core.verifyProductChainResponse(s,f.request,f.wallet,later,true));
  const recovered=f.recoverEnvelope(f.request,s);assert.equal(recovered.response.rawSignedTransaction,s.rawSignedTransaction);assert.equal(recovered.response.transactionHash,s.transactionHash);assert.equal(recovered.review.fingerprint,f.request.fingerprint);assert.ok(Buffer.byteLength(JSON.stringify({version:1,walletId:f.wallet.deviceId,request:f.request,response:s}))<128*1024);}
});
test('changed outer/inner signatures, signed bytes, identity, timestamps and replay are rejected',async()=>{
 for(const f of fixtures){assert.ok(f.signed);for(const change of [s=>s.fingerprint='0x'+'00'.repeat(32),s=>s.approvalSignature=s.innerApprovalSignature,s=>s.innerApprovalSignature=s.approvalSignature,s=>s.rawSignedTransaction='0x00',s=>s.transactionHash='wrong',s=>s.signedAt=f.request.expiresAt,s=>s.requestId=randomUUID(),s=>s.extra=true]){const s=structuredClone(f.signed);change(s);await assert.rejects(core.verifyProductChainResponse(s,f.request,f.wallet));}
  const r=structuredClone(f.request);r.requestId=r.chainRequest.requestId=randomUUID();innerFingerprint(r);await assert.rejects(core.verifyProductChainResponse(f.signed,r,f.wallet));}
});
test('verification snapshots caller-owned requests, responses and wallets before asynchronous crypto',async()=>{
 for(const f of fixtures){const request=structuredClone(f.request),wallet=structuredClone(f.wallet),response=structuredClone(f.signed),promise=core.verifyProductChainResponse(response,request,wallet);request.package.response.walletAuthorization='changed';wallet.deviceId=randomUUID();response.rawSignedTransaction='changed';const verified=await promise;assert.equal(verified.rawSignedTransaction,f.signed.rawSignedTransaction);}
});
test('oversize envelopes fail before signing and new online actions remain closed by production policy',async()=>{
 for(const f of fixtures){const r=structuredClone(f.request);r.package.result.extra='x'.repeat(64*1024);fingerprint(r);assert.throws(()=>core.validateProductChain(r),/64 KiB/);const policy=require('../tools/store-payment-policy.cjs');assert.throws(()=>policy.assertIntent(f.request));for(const action of ['hinkal-product-chain-preflight','hinkal-product-chain-broadcast'])assert.throws(()=>policy.assertOnlineJob({action,request:f.request}));assert.doesNotThrow(()=>policy.assertOnlineJob({action:'hinkal-product-chain-reconcile',request:f.request}));}
});

test('online reconciliation unwraps exact signed bytes only after complete validation and never broadcasts',async()=>{
 const {productChainOperation}=require('../dist/hinkal-product-chain-adapter.cjs');
 for(const f of fixtures){const calls=[],adapter={identity:async chain=>{calls.push(['identity',chain]);},rpc:async(chain,method,params)=>{calls.push([chain,method,params]);if(method==='eth_getTransactionReceipt')return null;if(method==='eth_getTransactionByHash')return {hash:f.signed.transactionHash};if(method==='getSignatureStatuses')return {value:[{confirmationStatus:'confirmed',err:null}]};throw Error('Unexpected fixture RPC');}};
  assert.deepEqual(await productChainOperation(adapter,'reconcile',f.request,f.signed),{state:'pending'});assert.equal(calls.filter(c=>/send|broadcast/i.test(c[1])).length,0);assert.ok(calls.some(c=>JSON.stringify(c).includes(f.signed.transactionHash)));
  calls.length=0;const response={...f.signed,approvalSignature:f.signed.innerApprovalSignature};await assert.rejects(productChainOperation(adapter,'reconcile',f.request,response));assert.equal(calls.length,0);
 }
});

test('production signing worker denies all exposed network transports before loading key-bearing code',()=>{
 const {spawnSync}=require('node:child_process');
 const script=`require('./dist/worker.cjs');process.stdin.removeAllListeners('end');const assert=require('node:assert/strict');for(const operation of [()=>fetch('https://example.invalid'),()=>require('node:net').connect(443,'example.invalid'),()=>new(require('node:net').Socket)().connect(443,'example.invalid'),()=>require('node:https').request('https://example.invalid'),()=>require('node:http2').connect('https://example.invalid'),()=>require('node:dgram').createSocket('udp4'),()=>require('node:dns').lookup('example.invalid'),()=>require('node:dns').promises.resolve('example.invalid'),()=>new WebSocket('wss://example.invalid')])assert.throws(operation,/Networking is disabled/);process.stdout.write('network-denied');process.exit(0);`;
 const result=spawnSync(process.execPath,['--no-addons','-e',script],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0);assert.equal(result.stdout,'network-denied');
});
