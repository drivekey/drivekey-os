'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const {privateViewFixture}=require('./helpers/private-view-fixture.cjs'),{depositDependencies}=require('./helpers/deposit-view-fixture.cjs');
const core=require('../dist/hinkal-view.cjs'),crypto=require('../dist/hinkal-view-crypto.cjs'),sol=require('../dist/hinkal-solana.cjs'),{authorizePrivateView}=require('../dist/hinkal-view-signer.cjs'),{prepareScopedViewJob}=require('../dist/hinkal-view-preparer.cjs');
let identity;before(async()=>{identity=await privateViewFixture('solana');});
async function fixture(asset='SOL'){
 const f=await privateViewFixture('solana',identity);f.request.profile=14;f.request.context={...f.request.context,action:'deposit',asset,inputNotes:[]};f.request.maximumAccountRent='10000000';f.request.fingerprint=core.viewFingerprint(f.request);f.response=await authorizePrivateView(f.vault,f.password,f.request,f.request.fingerprint);return f;
}
const input=f=>({request:f.request,response:f.response,transportPrivateKey:f.pair.privateKey});
const prepare=(f,deps=depositDependencies)=>prepareScopedViewJob(input(f),f.vault.public,Date.now(),()=>{throw Error('Deposit must not request a circuit proof');},{},deps);
test('SOL and canonical USDC deposits consume authenticated viewing access and return separately reviewed unsigned transactions',async()=>{
 for(const asset of ['SOL','USDC']){const f=await fixture(asset),r=await prepare(f),tx=core.validateDepositViewPreparation(f.request,f.response,r),view=crypto.openPrivateView(f.request,f.response.sealed,f.pair.privateKey);assert.equal(tx.asset,asset);assert.equal(tx.amount,f.request.context.amount);assert.equal(tx.recipient,f.vault.public.solanaAddress);assert.equal(r.blockchainTransactionSigned,false);assert.equal(Object.hasOwn(r,'productRequest'),false);assert.equal(JSON.stringify(r).includes(view.nullifyingKey),false);assert.equal(JSON.stringify(r).includes(f.pair.privateKey),false);assert.equal(JSON.stringify(r).includes(f.password),false);}
});
test('deposit scope rejects wrong chains, destinations, assets, amounts, notes and extra permissions',async()=>{
 const f=await fixture();for(const change of [r=>r.profile=15,r=>r.context.chain='ethereum',r=>r.context.recipient=identity.vault.public.evmAddress,r=>r.context.asset='ETH',r=>r.context.amount='0',r=>r.context.amount=(1n<<64n).toString(),r=>r.context.inputNotes=['0x01'],r=>r.context.pendingLeaves=['1'],r=>r.context.allowance='1',r=>r.nonce=0,r=>r.maximumAccountRent='10000001']){const r=structuredClone(f.request);change(r);r.fingerprint=core.viewFingerprint(r);assert.throws(()=>core.validateViewRequest(r));}
});
test('changed amount, asset, fee, rent, lifetime, chain or wrapper cannot be retained as the authorized deposit',async()=>{
 const f=await fixture(),r=await prepare(f);
 for(const change of [x=>x.transactionRequest.amount='2',x=>x.transactionRequest.asset='USDC',x=>x.transactionRequest.maximumFee='5001',x=>x.transactionRequest.accountRent='10000001',x=>x.transactionRequest.expiresAt=new Date(Date.parse(f.request.expiresAt)+1).toISOString(),x=>x.transactionRequest.network='devnet',x=>x.fingerprint='0x'+'00'.repeat(32),x=>x.submitted=true,x=>x.privateKey='forbidden']){const x=structuredClone(r);change(x);x.transactionRequest.fingerprint=sol.hinkalSolanaFingerprint(x.transactionRequest);assert.throws(()=>core.validateDepositViewPreparation(f.request,f.response,x));}
});
test('bad transport, forged authorization and wrong complete wallet fail before the deposit builder',async()=>{
 const f=await fixture();let calls=0;const deps={...depositDependencies,plan:async()=>{calls++;throw Error('Builder must not run');}};
 for(const change of [p=>p.response.sealed.tag='00'.repeat(16),p=>p.transportPrivateKey=crypto.createViewTransport().privateKey,p=>p.request.context.amount='2']){const p=input(f);p.request=structuredClone(p.request);p.response=structuredClone(p.response);change(p);await assert.rejects(prepareScopedViewJob(p,f.vault.public,Date.now(),undefined,{},deps));}
 await assert.rejects(prepareScopedViewJob(input(f),{...f.vault.public,deviceId:require('node:crypto').randomUUID()},Date.now(),undefined,{},deps));assert.equal(calls,0);
});
test('deposit deadline is capped by the original authorization and expired prepared packets remain recovery-only',async()=>{
 const f=await fixture();f.request.expiresAt=new Date(Date.now()+60000).toISOString();f.request.fingerprint=core.viewFingerprint(f.request);f.response=await authorizePrivateView(f.vault,f.password,f.request,f.request.fingerprint);const r=await prepare(f);assert.equal(r.transactionRequest.expiresAt,f.request.expiresAt);const later=Date.parse(f.request.expiresAt)+1;assert.throws(()=>core.validateDepositViewPreparation(f.request,f.response,r,later));assert.deepEqual(core.validateDepositViewPreparation(f.request,f.response,r,later,false),r.transactionRequest);
});
