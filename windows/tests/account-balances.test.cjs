'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAccountBalanceReader,PAIRS}=require('../account-balances.cjs');
const wallet={id:'11111111-1111-4111-8111-111111111111',deviceId:'device',evmAddress:'0x1111111111111111111111111111111111111111',solanaAddress:'11111111111111111111111111111111'};
test('public catalog read binds all four balances without selecting a signer',async()=>{const calls=[];const read=createAccountBalanceReader({isOffline:()=>false,getWallets:()=>[wallet],online:async input=>{calls.push(input);return {amount:'123',native:'123'};}});const result=await read({id:wallet.id});assert.equal(result.balances.length,4);assert.ok(result.balances.every(b=>b.amount==='123'&&!b.stale));assert.ok(calls.every(c=>c.action==='observed-balance'));assert.deepEqual(calls.map(c=>[c.chain,c.asset]),PAIRS);assert.ok(calls.every(c=>c.from===(c.chain==='ethereum'?wallet.evmAddress:wallet.solanaAddress)));await read({id:wallet.id});assert.equal(calls.length,4);});
test('unknown accounts, injected addresses and offline reads cannot reach network',async()=>{let calls=0;const args={getWallets:()=>[wallet],online:()=>{calls++;},isOffline:()=>false};const read=createAccountBalanceReader(args);for(const p of [{id:'22222222-2222-4222-8222-222222222222'},{id:wallet.id,from:'injected'},null])await assert.rejects(()=>read(p));await assert.rejects(()=>createAccountBalanceReader({...args,isOffline:()=>true})({id:wallet.id}),/offline/);assert.equal(calls,0);});
test('account replacement during a read discards results; errors never become zero',async()=>{let current={...wallet};const read=createAccountBalanceReader({isOffline:()=>false,getWallets:()=>[current],online:async()=>{current={...wallet,deviceId:'replacement'};return {amount:'999'};}});await assert.rejects(()=>read({id:wallet.id}),/changed/);const failed=createAccountBalanceReader({isOffline:()=>false,getWallets:()=>[wallet],online:async()=>{throw Error('private-shaped upstream error');}});const result=await failed({id:wallet.id});assert.ok(result.balances.every(b=>b.stale&&b.amount===undefined));});

test('portfolio observations use latest state while spend checks keep pending state',async()=>{const {OnlineAdapter}=require('../dist/adapter.cjs');const seen=[];const adapter=new OnlineAdapter({ethereum:'https://fixture.invalid'},async(_url,init)=>{const j=JSON.parse(init.body);seen.push(j);const result=j.method==='eth_chainId'?'0x1':j.method==='eth_getBalance'?'0x1':j.params[0].data==='0x313ce567'?'0x'+(6n).toString(16).padStart(64,'0'):'0x'+(12n).toString(16).padStart(64,'0');return {jsonrpc:'2.0',id:j.id,result};});await adapter.balance('ethereum',wallet.evmAddress,'USDC','latest');assert.ok(seen.filter(j=>j.method==='eth_getBalance'||j.method==='eth_call').every(j=>j.params[1]==='latest'));seen.length=0;await adapter.balance('ethereum',wallet.evmAddress,'USDC');assert.ok(seen.filter(j=>j.method==='eth_getBalance'||j.method==='eth_call'&&j.params[0].data!=='0x313ce567').every(j=>j.params[1]==='pending'));await assert.rejects(()=>adapter.balance('ethereum',wallet.evmAddress,'ETH','earliest'),/Invalid/);});


test('cancelled observations stop between assets and cannot populate the cache', async () => {
 const controller = new AbortController();
 let calls = 0;
 const reader = createAccountBalanceReader({
  isOffline: () => false,
  getWallets: () => [wallet],
  online: async (_input, signal) => {
   assert.equal(signal, controller.signal);
   calls++;
   controller.abort();
   return {amount: '100'};
  }
 });
 await assert.rejects(reader({id: wallet.id}, controller.signal));
 assert.equal(calls, 1);
});
