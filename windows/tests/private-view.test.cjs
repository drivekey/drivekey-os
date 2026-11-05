'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {privateViewFixture,providerDouble}=require('./helpers/private-view-fixture.cjs');
const core=require('../dist/hinkal-view.cjs'),crypto=require('../dist/hinkal-view-crypto.cjs'),{authorizePrivateView}=require('../dist/hinkal-view-signer.cjs'),{prepareScopedViewJob}=require('../dist/hinkal-view-preparer.cjs');
let eth,sol;before(async()=>{eth=await privateViewFixture();sol=await privateViewFixture('solana',eth);});
const input=f=>({request:f.request,response:f.response,transportPrivateKey:f.pair.privateKey});
test('genuine Ethereum and Solana view responses are authenticated, sealed to the original request and reveal no plaintext capability',()=>{
 for(const f of [eth,sol]){assert.deepEqual(core.verifyViewResponse(f.request,f.response),f.response);const view=crypto.openPrivateView(f.request,f.response.sealed,f.pair.privateKey),serialized=JSON.stringify({request:f.request,response:f.response});assert.ok(!serialized.includes(view.nullifyingKey),'Plaintext view key escaped');assert.ok(!serialized.includes(f.password),'Unlock data escaped');assert.ok(!serialized.includes(f.pair.privateKey),'Transport private key escaped');assert.equal(view.address,f.request.context.from);assert.equal(view.readOnly,true);assert.equal(Object.hasOwn(view,'signEddsa'),false);assert.equal(Object.hasOwn(f.response,'rawSignedTransaction'),false);assert.equal(f.response.blockchainTransactionSigned,false);assert.throws(()=>crypto.openPrivateView(f.request,f.response.sealed,crypto.createViewTransport().privateKey),/original transport/);view.nullifyingKey=undefined;}
});
test('fixed login identity survives another fresh transport request without changing the original sealed bytes',async()=>{
 const another=await privateViewFixture('ethereum',eth),first=crypto.openPrivateView(eth.request,eth.response.sealed,eth.pair.privateKey),second=crypto.openPrivateView(another.request,another.response.sealed,another.pair.privateKey);assert.ok(first.nullifyingKey===second.nullifyingKey,'Fixed identity changed');assert.deepEqual(first.spendingPublicKey,second.spendingPublicKey);assert.notEqual(eth.response.sealed.ciphertext,another.response.sealed.ciphertext);first.nullifyingKey=second.nullifyingKey=undefined;
});
test('view review rejects wrong wallets, profiles, chains, tokens, excessive permissions and unreviewed fields',()=>{
 for(const mutate of [r=>r.wallet.solanaAddress=sol.request.wallet.evmAddress,r=>r.deviceId=randomUUID(),r=>r.profile=15,r=>r.context.asset='SOL',r=>r.context.pendingLeaves=['1'],r=>r.context.privateKey='forbidden',r=>r.maximumFee='9999999999999999999999',r=>r.maximumAccountRent='1',r=>r.unsignedTransaction='forbidden',r=>r.transportPublicKey=Buffer.alloc(44).toString('base64')]){const r=structuredClone(eth.request);mutate(r);r.fingerprint=core.viewFingerprint(r);assert.throws(()=>core.validateViewRequest(r));}
 const wallet=structuredClone(eth.vault.public);wallet.solanaAddress='11111111111111111111111111111111';assert.throws(()=>core.assertViewWallet(eth.request,wallet),/complete wallet/);
});
test('changed ciphertext, tag, IV, public key, time, request and wallet approval are refused',()=>{
 for(const mutate of [s=>s.sealed.ciphertext=Buffer.from('tampered').toString('base64'),s=>s.sealed.tag='00'.repeat(16),s=>s.sealed.iv='00'.repeat(12),s=>s.sealed.ephemeralPublicKey=crypto.createViewTransport().transportPublicKey,s=>s.authorizedAt=eth.request.expiresAt,s=>s.requestId=randomUUID(),s=>s.walletAuthorization='0x'+'11'.repeat(65)]){const s=structuredClone(eth.response);mutate(s);assert.throws(()=>core.verifyViewResponse(eth.request,s));}
 const modified=structuredClone(eth.response.sealed);modified.tag='00'.repeat(16);assert.throws(()=>crypto.openPrivateView(eth.request,modified,eth.pair.privateKey),/original transport/);
});
test('expired sealed responses remain historical evidence but cannot create new view authority',async()=>{
 const later=Date.parse(eth.request.expiresAt)+1;assert.deepEqual(core.verifyViewResponse(eth.request,eth.response,later,false),eth.response);assert.throws(()=>core.verifyViewResponse(eth.request,eth.response,later));await assert.rejects(authorizePrivateView(eth.vault,eth.password,eth.request,eth.request.fingerprint,later));
});
test('offline view authorization snapshots the request before asynchronous unlock',async()=>{
 const mutable=structuredClone(eth.request),original=structuredClone(mutable),result=authorizePrivateView(eth.vault,eth.password,mutable,mutable.fingerprint);mutable.transportPublicKey=crypto.createViewTransport().transportPublicKey;mutable.fingerprint=core.viewFingerprint(mutable);const response=await result;assert.equal(core.verifyViewResponse(original,response).fingerprint,original.fingerprint);assert.throws(()=>core.verifyViewResponse(mutable,response));
});
test('isolated preparation consumes genuine view capability and returns only a bound unsigned public job (provider double)',async()=>{
 for(const f of [eth,sol]){let calls=0,secret;const result=await prepareScopedViewJob(input(f),f.vault.public,Date.now(),async(profile,p)=>{calls++;assert.equal(p.view.readOnly,true);assert.equal(Object.hasOwn(p.view,'loginSignature'),false);secret=p.view.nullifyingKey;return providerDouble(profile,p);});assert.equal(calls,1);assert.equal(result.productRequest.seed.version,f.request.profile);assert.deepEqual(result.productRequest.seed.job.context,f.request.context);assert.ok(!JSON.stringify(result).includes(secret),'View key escaped preparation');assert.ok(!JSON.stringify(result).includes(f.pair.privateKey),'Transport key escaped preparation');assert.equal(result.blockchainTransactionSigned,false);}
});
test('tampered view, transport key or wallet cannot reach provider preparation',async()=>{
 let calls=0;const provider=()=>{calls++;throw Error('Provider must not run');};
 for(const change of [p=>p.transportPrivateKey=crypto.createViewTransport().privateKey,p=>p.response.sealed.iv='00'.repeat(12),p=>p.response.walletAuthorization='0x'+'11'.repeat(65),p=>p.request.context.amount='2']){const p=structuredClone(input(eth));change(p);await assert.rejects(prepareScopedViewJob(p,eth.vault.public,Date.now(),provider));}
 await assert.rejects(prepareScopedViewJob(input(eth),{...eth.vault.public,solanaAddress:'11111111111111111111111111111111'},Date.now(),provider));assert.equal(calls,0);
});
test('provider output cannot leak the plaintext key, change context or mutate the original spending identity',async()=>{
 for(const mode of ['leak','scope'])await assert.rejects(prepareScopedViewJob(input(eth),eth.vault.public,Date.now(),async(profile,p)=>{const job=providerDouble(profile,p);if(mode==='leak')job.response.echo=p.view.nullifyingKey;else job.context.amount='2';return job;}));
 const expected=crypto.openPrivateView(eth.request,eth.response.sealed,eth.pair.privateKey).spendingPublicKey;
 const result=await prepareScopedViewJob(input(eth),eth.vault.public,Date.now(),async(profile,p)=>{p.view.spendingPublicKey[0]='1';return providerDouble(profile,p);});assert.deepEqual(result.productRequest.expectedSpendingPublicKey,expected);
});
