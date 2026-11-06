'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createPublicHistoryBlockPacer:pacer,strictPublicHistoryJSON:read,observePublicHistoryReferences:observe}=require('../dist/hinkal-note-history-online.cjs');
const a='https://api.mainnet-beta.solana.com',b='https://solana-rpc.publicnode.com',request=(method='getBlock',signal)=>({method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]}),signal});

test('public getBlock pacing includes the first call and serializes actual starts per origin',async()=>{
 const pace=pacer(),start=performance.now(),times=[[],[]];
 await Promise.all([pace(a,request()).then(()=>times[0].push(performance.now())),pace(a,request()).then(()=>times[0].push(performance.now())),pace(b,request()).then(()=>times[1].push(performance.now()))]);
 assert.equal(times[0].length,2);assert.equal(times[1].length,1);for(const list of times)assert.ok(list[0]-start>=2190);assert.ok(times[0][1]-times[0][0]>=2190);
});

test('queued and first-delay cancellation return promptly and never grant a read start',async()=>{
 const pace=pacer(),first=new AbortController(),queued=new AbortController(),calls=[];
 const one=pace(a,request('getBlock',first.signal)).then(()=>calls.push(1)),two=pace(a,request('getBlock',queued.signal)).then(()=>calls.push(2)),oneRejected=assert.rejects(one),twoRejected=assert.rejects(two);queued.abort(Error('queued canceled'));first.abort(Error('first canceled'));await Promise.all([oneRejected,twoRejected]);assert.deepEqual(calls,[]);
});

test('pacing is confined to known public getBlock endpoints and does not delay other RPC methods',async()=>{
 const pace=pacer(),start=performance.now();await Promise.all([pace(a,request('getSlot')),pace(b,request('getTransaction')),pace('https://rpc.example',request()),pace(a,{method:'GET'})]);assert.ok(performance.now()-start<1000);
});

test('public HTTP 429 fails once without retry and retains the combined caller cancellation signal',async()=>{
 const original=global.fetch,c=new AbortController();let calls=0,seen;global.fetch=async(_url,init)=>{calls++;seen=init.signal;return new Response('{}',{status:429});};try{await assert.rejects(read('https://rpc.example',request('getBlock',c.signal)),/HTTP 429/);assert.equal(calls,1);assert.notEqual(seen,c.signal);assert.equal(seen.aborted,false);c.abort(Error('stop public read'));assert.equal(seen.aborted,true);}finally{global.fetch=original;}
});

test('a pre-canceled public request never reaches fetch and cancellation during fetch is preserved',async()=>{
 const original=global.fetch,first=new AbortController();first.abort(Error('already canceled'));let calls=0;global.fetch=async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));};try{await assert.rejects(read(a,request('getBlock',first.signal)),/already canceled/);assert.equal(calls,0);const current=new AbortController(),pending=read('https://rpc.example',request('getBlock',current.signal));await new Promise(resolve=>setImmediate(resolve));current.abort(Error('read canceled'));await assert.rejects(pending,/read canceled/);assert.equal(calls,1);}finally{global.fetch=original;}
});

test('slow epoch reads pass elapsed monotonic time to canonical receipt batches without accepting future heads',async()=>{
 const {solanaHistoryRPC}=require('./helpers/hinkal-note-history-rpc.cjs'),fixture=require('./fixtures/hinkal-note-history-receipts.json'),descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance'),now=Date.now();let elapsed=0,epochs=0;Object.defineProperty(globalThis,'performance',{value:{now:()=>elapsed},configurable:true});
 try{const readers=[0,1].map(i=>{const f=solanaHistoryRPC('elapsed-'+i,{now,change:(call,value)=>call.method==='getBlock'&&call.params[0]===f.headSlot?{...value,blockTime:Math.floor((now+elapsed)/1000)}:undefined}),rpc=f.a.rpc;f.a.rpc=async(chain,method,params)=>{if(method==='getEpochInfo'){if(++epochs===2)elapsed=61000;return {absoluteSlot:f.headSlot,epoch:Math.floor(f.headSlot/432000),slotIndex:f.headSlot%432000,slotsInEpoch:432000};}return rpc(chain,method,params);};return f.a;});const r=await observe('solana',[{transactionId:fixture.chains.solana.transactionId,position:fixture.chains.solana.receipt.slot}],readers,now);assert.equal(r.receipts.length,1);assert.equal(r.eligibleForSigning,false);assert.equal(r.ciphertextHistoryVerified,false);assert.equal(r.batches[0].receiptSourcePolicy,'two-independent-canonical-rpcs');}finally{Object.defineProperty(globalThis,'performance',descriptor);}
});
