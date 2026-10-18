'use client';
import {useEffect,useRef,useState} from 'react';
import {LifiNativeSwap} from './lifi-native-swap';
import {usePublicWallet} from './wallet-context';
import {isMultiWallet,readPublicWalletFile} from '@/core/app-wallet';
import {LIFI_ASSETS,type LifiAssetKey,type LifiQuote,type LifiCost} from '@/core/lifi-assets';
const keys=Object.keys(LIFI_ASSETS) as LifiAssetKey[];
const label=(key:LifiAssetKey)=>`${LIFI_ASSETS[key].symbol} · ${LIFI_ASSETS[key].network}`;
function Costs({items}:{items:LifiCost[]}){return items.length?<ul>{items.map((c,i)=><li key={i}>{c.name}: {c.amount} {c.symbol} · {c.included===true?'included in quote':c.included===false?'additional cost':'inclusion not specified'}<details><summary>Cost token</summary><p>Chain ID {c.chainId} · {c.address}</p></details></li>)}</ul>:<p>No itemized fees returned. Costs may be included in the rate.</p>;}
export function LifiQuotes(){
 const shared=usePublicWallet(),wallet=isMultiWallet(shared.wallet)?shared.wallet:null;
 const [from,setFrom]=useState<LifiAssetKey>('ethereum-eth'),[to,setTo]=useState<LifiAssetKey>('ethereum-usdc'),[amount,setAmount]=useState(''),[slippage,setSlippage]=useState(50),[quote,setQuote]=useState<LifiQuote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(0);
 const request=useRef(0),controller=useRef<AbortController|null>(null);
 function invalidate(){request.current++;controller.current?.abort();setQuote(null);setBusy(false);setError('');}
 useEffect(()=>{invalidate();return()=>{request.current++;controller.current?.abort();};},[shared.wallet]);
 useEffect(()=>{if(!quote)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[quote]);
 async function refresh(){
  if(!wallet||busy)return;const id=++request.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;const timer=setTimeout(()=>abort.abort(),30000);setBusy(true);setQuote(null);setError('');
  try{const response=await fetch('/api/providers/lifi/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wallet,from,to,amount,slippageBps:slippage}),cache:'no-store',signal:abort.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Quote unavailable.');if(id===request.current){setQuote(data);setNow(Date.now());}}
  catch(e){if(id===request.current)setError(abort.signal.aborted?'LI.FI timed out. Try a fresh quote. Nothing was submitted.':e instanceof Error?e.message:'Quote unavailable.');}
  finally{clearTimeout(timer);if(id===request.current)setBusy(false);}
 }
 return <><LifiNativeSwap/><section className="payments-card" aria-label="LI.FI multichain quotes"><h2>Multichain quotes</h2><p className="payments-notice">Quote only. Use the ETH → USDC form above to swap on Ethereum.</p><p>0% DriveKey fee. Provider and network fees apply.</p>
  {!wallet&&<label>Multichain public wallet<input type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0];if(f)void(async()=>{try{const w=await readPublicWalletFile(f);if(!isMultiWallet(w))throw Error('Choose wallet-multi-public.json.');shared.importWallet(w);invalidate();}catch(e){setError(e instanceof Error?e.message:'Public wallet could not be read.');}})();}}/></label>}
  <div className="payments-row"><label>You pay<select aria-label="You pay" value={from} onChange={e=>{invalidate();setFrom(e.target.value as LifiAssetKey);}}>{keys.map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label><label>You receive<select aria-label="You receive" value={to} onChange={e=>{invalidate();setTo(e.target.value as LifiAssetKey);}}>{keys.map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label></div>
  <div className="payments-row"><label>Amount<input inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>{invalidate();setAmount(e.target.value);}}/></label><label>Slippage limit<select aria-label="Slippage limit" value={slippage} onChange={e=>{invalidate();setSlippage(Number(e.target.value));}}><option value={25}>0.25%</option><option value={50}>0.5%</option><option value={100}>1%</option></select></label></div>
  {wallet&&<p className="payments-address">Receive on {LIFI_ASSETS[to].network}: {LIFI_ASSETS[to].network==='Solana'?wallet.solanaAddress:wallet.evmAddress}</p>}
  <button disabled={busy||!wallet||!amount||from===to} onClick={()=>void refresh()}>{busy?'Finding a live route…':'Get LI.FI quote'}</button>
  <p role="status" aria-live="polite">{error||(!quote?'':now-Date.parse(quote.checkedAt)>=60000?'Quote needs refreshing.':`Updated ${new Date(quote.checkedAt).toLocaleTimeString()} · Refresh after 60 seconds.`)}</p>
  {quote&&<div aria-label="LI.FI quote result"><dl className="asset-review"><div><dt>Route</dt><dd>LI.FI · {quote.route}</dd></div><div><dt>You pay</dt><dd>{quote.sendAmount} {label(quote.from)}</dd></div><div><dt>Estimated received</dt><dd>{quote.receiveAmount} {label(quote.to)}</dd></div><div><dt>Quoted minimum received</dt><dd>{quote.minimumReceived} {label(quote.to)}</dd></div><div><dt>Provider time estimate</dt><dd>{quote.durationSeconds} seconds; network waits can take longer.</dd></div><div><dt>Provider and route fees</dt><dd><Costs items={quote.fees}/></dd></div><div><dt>Estimated network costs</dt><dd><Costs items={quote.gas}/></dd></div></dl><p>Estimate only; no rate lock or balance check.</p><details><summary>Quote details</summary><p>From: {quote.fromAddress}<br/>To: {quote.toAddress}<br/>Quote: {quote.quoteId}</p><p>Pay token: {LIFI_ASSETS[quote.from].address}<br/>Receive token: {LIFI_ASSETS[quote.to].address}</p><p>{quote.notice} Refreshing after 60 seconds does not extend a rate lock. A quote is not proof of settlement.</p></details></div>}
 </section></>;
}
