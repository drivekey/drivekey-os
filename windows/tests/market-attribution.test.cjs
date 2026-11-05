'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveWebRoute}=require('../web-links.cjs');
const policy=require('../tools/store-payment-policy.cjs');
function handler(offline=false){
 const source=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 const begin=source.indexOf("register('open-web',"),end=source.indexOf("register('list-updates',",begin);
 assert.ok(begin>=0&&end>begin);
 const handlers=new Map(),opened=[];
 const shell={openExternal:async url=>opened.push(url)};
 new Function('register','OFFLINE','paymentPolicy','resolveWebRoute','shell',source.slice(begin,end))((name,fn)=>handlers.set(name,fn),offline,policy,resolveWebRoute,shell);
 return {open:handlers.get('open-web'),opened,shell};
}
test('market attribution opens only the pinned provider URL and preserves deferred-route denial',async()=>{
 const online=handler();
 assert.equal((await online.open({route:'market-data',option:'coingecko'})).opened,true);
 assert.deepEqual(online.opened,['https://www.coingecko.com']);
 for(const option of ['https://evil.invalid','coingecko?wallet=private','CoinGecko',null,{}])await assert.rejects(()=>online.open({route:'market-data',option}),/Unknown market/);
 for(const route of ['swap','send','hinkal-pay','savings','https://evil.invalid'])await assert.rejects(()=>online.open({route,option:'coingecko'}),/direct ETH/);
 await online.open({route:'article',option:'workflow'});
 assert.equal(online.opened.length,2);
 assert.ok(online.opened[1].startsWith('https://x.com/DriveKeyyy/status/'));
 const offline=handler(true);
 await assert.rejects(()=>offline.open({route:'market-data',option:'coingecko'}),/offline/);
 assert.deepEqual(offline.opened,[]);
});
test('failed external opening does not report a successful market-source handoff',async()=>{
 const context=handler();context.shell.openExternal=async()=>{throw Error('Browser unavailable');};
 await assert.rejects(()=>context.open({route:'market-data',option:'coingecko'}),/Browser unavailable/);
});
