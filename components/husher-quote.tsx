'use client';
import {useEffect,useRef,useState} from 'react';
import type {inspectHusherStandardQuote} from '@/core/husher-api';
type Quote=Awaited<ReturnType<typeof inspectHusherStandardQuote>>;
export function HusherQuote({onUse}:{onUse?:(quote:Quote)=>void}){
 const [amount,setAmount]=useState('10'),[quote,setQuote]=useState<Quote|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(0);
 const sequence=useRef(0);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{clearInterval(timer);sequence.current++;};},[]);
 const stale=!!quote&&now-Date.parse(quote.checkedAt)>=quote.refreshAfterSeconds*1000;
 async function refresh(){
  const id=++sequence.current;setBusy(true);setQuote(null);setError('');
  try{
   const response=await fetch('/api/providers/husher/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiveAmount:amount}),cache:'no-store'});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Quote unavailable.');
   if(id===sequence.current){setQuote(data);setNow(Date.now());}
  }catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:'Quote unavailable.');}
  finally{if(id===sequence.current)setBusy(false);}
 }
 return <section className="payments-card" aria-label="Live Husher quote"><h2>Exchange quote</h2><p>Choose your USDC payout after fees.</p>
  <label>You receive (USDC)<input inputMode="decimal" value={amount} onChange={e=>{sequence.current++;setAmount(e.target.value);setQuote(null);setError('');setBusy(false);}}/></label>
  <button disabled={busy||!amount} onClick={()=>void refresh()}>{busy?'Getting quote…':'Get quote'}</button>
  <p role="status" aria-live="polite">{error||(!quote?'':stale?'Quote needs refreshing.':`Updated ${new Date(quote.checkedAt).toLocaleTimeString()} · Refresh after 60 seconds.`)}</p>
  {quote&&<><dl className="asset-review">
   <div><dt>Required deposit</dt><dd>{quote.sendAmount} ETH</dd></div>
   <div><dt>Net payout</dt><dd>{quote.receiveAmount} USDC</dd></div>
   <div><dt>Minimum deposit</dt><dd>{quote.minimumSendAmount} ETH</dd></div>
   {quote.minimumReceiveAmount!==null&&<div><dt>Minimum payout</dt><dd>{quote.minimumReceiveAmount} USDC</dd></div>}
   <div><dt>Exchange fee</dt><dd>{quote.feeAmount} USDC</dd></div>
   <div><dt>Withdrawal fee</dt><dd>{quote.networkFee} USDC</dd></div>
   <div><dt>Total provider fees (included)</dt><dd>{quote.totalProviderFees} USDC</dd></div>
   <div><dt>Provider time estimate</dt><dd>{quote.estimatedTimeSeconds} seconds; confirmation waits may be longer.</dd></div>
  </dl>
  {!quote.meetsMinimum&&<p role="status">This amount is below the provider minimum. Increase the payout and refresh.</p>}
  {!quote.withinMaximum&&<p role="status">This amount exceeds the provider payout limit. Lower the payout and refresh.</p>}
  {!quote.networkEchoVerified&&<p>Provider network metadata was incomplete. Order asset checks are still required.</p>}
  <p>Ethereum gas is additional. This estimate does not lock a rate.</p><details><summary>Quote terms</summary><p>{quote.notice} The 60-second reminder is for refreshing this estimate.</p></details>
  {onUse&&<><button disabled={stale||!quote.meetsMinimum||!quote.withinMaximum||busy} onClick={()=>{if(Date.now()-Date.parse(quote.checkedAt)>=quote.refreshAfterSeconds*1000){setNow(Date.now());return;}onUse(quote);}}>Use quote</button><p>Order fee limit: {quote.suggestedFeeCeiling} USDC, rounded up.</p></>}
  </>}
 </section>;
}
