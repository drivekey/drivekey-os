import { NextResponse } from 'next/server';
import {CURRENCIES} from '@/core/display-currency';
export const runtime='nodejs';
const coins=['bitcoin','ethereum','ethereum-wormhole','solana','usd-coin','chainlink','uniswap','aave','dai'];
let saved:{at:number;data:unknown}|null=null;
export async function GET(){
 if(saved&&Date.now()-saved.at<60000)return NextResponse.json(saved.data);
 try{
  const url='https://api.coingecko.com/api/v3/simple/price?ids='+coins.join(',')+'&vs_currencies='+Object.keys(CURRENCIES).join(',').toLowerCase()+'&include_24hr_change=true&include_last_updated_at=true';
  const r=await fetch(url,{signal:AbortSignal.timeout(8000),cache:'no-store'});if(!r.ok)throw Error();
  const text=await r.text();if(text.length>32000)throw Error();const raw=JSON.parse(text);
  const prices=Object.fromEntries(coins.flatMap(id=>{const p=raw[id];if(!p||!Number.isSafeInteger(p.last_updated_at))return[];const rates=Object.fromEntries(Object.keys(CURRENCIES).flatMap(c=>Number.isFinite(p[c.toLowerCase()])&&p[c.toLowerCase()]>=0?[[c,p[c.toLowerCase()]]]:[]));if(!Object.keys(rates).length)return [];return[[id,{rates,usd:p.usd,pln:p.pln,change:Number.isFinite(p.usd_24h_change)?p.usd_24h_change:null,updatedAt:p.last_updated_at*1000}]];}));
  if(!Object.keys(prices).length)throw Error();const data={source:'CoinGecko',prices};saved={at:Date.now(),data};return NextResponse.json(data);
 }catch{return NextResponse.json({source:'CoinGecko',prices:{},error:'Market data is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
