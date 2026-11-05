'use strict';
const ASSETS=Object.freeze([
 {id:'bitcoin',symbol:'BTC',name:'Bitcoin',walletSupported:false},
 {id:'ethereum',symbol:'ETH',name:'Ethereum',walletSupported:true},
 {id:'solana',symbol:'SOL',name:'Solana',walletSupported:true},
 {id:'usd-coin',symbol:'USDC',name:'USD Coin',walletSupported:true},
 {id:'tether',symbol:'USDT',name:'Tether',walletSupported:false}
]);
function validateCurrency(input){if(!input||Object.keys(input).length!==1||!['usd','eur','pln'].includes(input.currency))throw Error('Choose USD, EUR or PLN for market values.');return input.currency;}
function createMarketService({isOffline,fetch:fetcher=globalThis.fetch,now=Date.now}){
 const cache=new Map(),pending=new Map(),retryAfter=new Map();
 async function snapshot(input){
  if(isOffline())throw Error('Market networking is disabled in the offline companion.');
  const currency=validateCurrency(input),previous=cache.get(currency);
  if(previous&&now()-previous.fetchedAt<60000)return {...previous.value,stale:now()-previous.providerTime>300000};
  if(pending.has(currency))return pending.get(currency);
  if(now()<(retryAfter.get(currency)||0)){if(previous)return {...previous.value,stale:true,error:'Market refresh unavailable. Showing the last successful prices.'};throw Error('Market data unavailable. Try again later.');}
  const operation=(async()=>{
   try{
    const url=new URL('https://api.coingecko.com/api/v3/coins/markets');url.searchParams.set('vs_currency',currency);url.searchParams.set('ids',ASSETS.map(a=>a.id).join(','));url.searchParams.set('sparkline','false');
    const response=await fetcher(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:{Accept:'application/json'}});
    if(!response.ok)throw Error();
    const parts=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>131072){await response.body.cancel?.().catch(()=>{});throw Error();}parts.push(Buffer.from(chunk));}
    const raw=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!Array.isArray(raw)||raw.length>ASSETS.length)throw Error();
    const prices=ASSETS.map(asset=>{const rows=raw.filter(r=>r.id===asset.id);if(rows.length!==1)throw Error();const row=rows[0],stamp=Date.parse(row.last_updated);if(!Number.isFinite(row.current_price)||row.current_price<=0||!Number.isFinite(stamp)||stamp>now()+300000)throw Error();const change=row.price_change_percentage_24h;return {...asset,price:row.current_price,change24h:Number.isFinite(change)&&change>=-100&&change<1000000?change:null,asOf:new Date(stamp).toISOString()};});
    const providerTime=Math.min(...prices.map(p=>Date.parse(p.asOf))),value={currency,source:'CoinGecko',fetchedAt:new Date(now()).toISOString(),prices,stale:now()-providerTime>300000};cache.set(currency,{fetchedAt:now(),providerTime,value});retryAfter.delete(currency);return value;
   }catch{retryAfter.set(currency,now()+60000);if(previous)return {...previous.value,stale:true,error:'Market refresh unavailable. Showing the last successful prices.'};throw Error('Market data unavailable. Try again later.');}
  })();pending.set(currency,operation);try{return await operation;}finally{pending.delete(currency);}
 }
 return Object.freeze({snapshot});
}
module.exports={ASSETS,createMarketService,validateCurrency};
