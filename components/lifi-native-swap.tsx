'use client';
import {readStrictPublicJsonFile} from '@/core/strict-public-json';
import {useEffect,useRef,useState} from 'react';
import {formatUnits} from 'ethers';
import {usePublicWallet} from './wallet-context';
import {useCapabilities} from './feature-status';
import {isMultiWallet} from '@/core/app-wallet';
import {validateLifiRequest,verifyLifiResponse,lifiReview,type LifiRequest,type LifiResponse} from '@/core/lifi-protocol';
import {withTradeJournal} from '@/core/trade-journal';
import type {TradeAttempt} from '@/core/trade-submission';
import {liveExecutionEnabled,LIVE_RELEASE} from '@/core/live-release-policy';
import {createMacPublicSession} from '@/core/mac-public-session';
async function api(action:string,input:unknown){const r=await fetch('/api/providers/lifi/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input}),cache:'no-store',signal:AbortSignal.timeout(55000)});const d=await r.json();if(!r.ok)throw Error(d.error||'LI.FI operation failed.');return d;}
async function read(file:File){return readStrictPublicJsonFile(file,60000);}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function LifiNativeSwap(){
 const shared=usePublicWallet(),wallet=isMultiWallet(shared.wallet)?shared.wallet:null;
 const capabilities=useCapabilities(),preparationAvailable=capabilities?.ethereum?.configured===true;
 const [amount,setAmount]=useState('0.001'),[slippage,setSlippage]=useState(50),[request,setRequest]=useState<LifiRequest|null>(null),[response,setResponse]=useState<LifiResponse|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[consent,setConsent]=useState(false),[message,setMessage]=useState(''),[outcome,setOutcome]=useState<{state:string;hash?:string;deliveryVerified?:boolean;receivedBaseUnits?:string;finality?:string}|null>(null);
 const working=useRef(false),generation=useRef(0);
 const key=wallet?'drivekey-lifi-v9:'+wallet.deviceId+':'+wallet.evmAddress.toLowerCase():null;
 useEffect(()=>{generation.current++;setRequest(null);setResponse(null);setReady(false);setConsent(false);setOutcome(null);setMessage('');if(!key||!wallet)return;
  try{const saved=localStorage.getItem(key);if(saved){const data=JSON.parse(saved),r=validateLifiRequest(data.request,Date.now(),false);if(r.deviceId!==wallet.deviceId||r.from.toLowerCase()!==wallet.evmAddress.toLowerCase())throw Error('Saved request belongs to a different wallet.');setRequest(r);if(data.response)setResponse(verifyLifiResponse(data.response,r,wallet,Date.now(),false));setMessage('Saved approval restored. Check the transaction status before any submission.');}}catch(e){setMessage(e instanceof Error?e.message:'Saved approval could not be restored.');}
  return()=>{generation.current++;};
 // Wallet identity is the persistence boundary.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);
 function save(r:LifiRequest,s:LifiResponse|null){if(!key)throw Error('Import your public wallet.');const value=JSON.stringify({request:r,response:s});localStorage.setItem(key,value);if(localStorage.getItem(key)!==value)throw Error('Could not save this approval for reboot recovery.');}
 async function run(fn:(current:()=>boolean)=>Promise<void>){if(working.current)return;working.current=true;setBusy(true);const id=generation.current;try{await fn(()=>id===generation.current);}catch(e){if(id===generation.current){setReady(false);setConsent(false);setMessage(e instanceof Error?e.message:'Operation stopped.');}}finally{working.current=false;setBusy(false);}}
 const signed=()=>{if(!wallet||!request||!response)throw Error('Import the matching signed response first.');return {wallet,request,response};};
 async function reconcile(submit:boolean,current:()=>boolean){
  if(submit&&!liveExecutionEnabled('lifi'))throw Error(LIVE_RELEASE.reason);
  const a=signed();await withTradeJournal('ethereum:'+a.wallet.evmAddress.toLowerCase(),a.response.transactionHash,a.request.fingerprint,async store=>{
   let old=await store.read();let result;
   if(!submit||old){result=await api('status',a);}
   else{
    if(!consent||!ready)throw Error('Review the approval and run preflight before submitting.');
    verifyLifiResponse(a.response,a.request,a.wallet);await api('preflight',a);if(!current())throw Error('Wallet changed.');
    old={hash:a.response.transactionHash,fingerprint:a.request.fingerprint,state:'unknown'};await store.write(old);const persisted=await store.read();if(persisted?.hash!==old.hash||persisted.state!=='unknown')throw Error('Submission intent was not saved.');
    validateLifiRequest(a.request);if(current()){setReady(false);setConsent(false);setOutcome({state:'unknown',hash:a.response.transactionHash});}
    try{result=await api('submit',{...a,consent:true});}catch{result={state:'unknown',hash:a.response.transactionHash,message:'Submission outcome unknown. Check this hash; no automatic resend.'};}
   }
   if(['submitted','confirmed','failed'].includes(result.state))await store.write({hash:a.response.transactionHash,fingerprint:a.request.fingerprint,state:result.state as TradeAttempt['state']});
   if(current()){setOutcome(result);setReady(false);setConsent(false);setMessage(result.message|| (result.state==='confirmed'&&result.deliveryVerified?'Finalized USDC delivery verified.':result.state==='failed'?'Transaction failed on Ethereum.':result.finality==='finalized'&&!result.deliveryVerified?'Transaction finalized, but USDC delivery is not verified. Keep the recovery record.':result.state==='unknown'?'No receipt found. If submission was attempted, keep checking this hash.':'Waiting for Ethereum finality and verified USDC delivery.'));}
  });
 }
 const review=request?lifiReview(request,false):null;
 return <section className="payments-card" aria-label="LI.FI native ETH swap"><h2>ETH → USDC</h2><p>Ethereum · LI.FI / Sushi · Receive in your wallet.</p><p className="payments-notice">Sign offline within 30 minutes. Provider, pool and network fees apply.</p><details><summary>Offline signing requirements</summary><p>Use the LI.FI v9 offline signer. Export the request, reboot into DriveKey and review it before signing. Return here to import the response and submit.</p></details>
 {!wallet&&<p>Load your multichain public wallet to begin.</p>}
 {!preparationAvailable&&<p role="status">{capabilities?.ethereum?.configured===false?'Swap preparation is unavailable. The Ethereum connection needs configuration.':'Swap preparation is unavailable until the Ethereum connection is checked.'} You can still view quotes.</p>}
 {!liveExecutionEnabled('lifi')&&<p>Sending is disabled pending release verification.</p>}
 <fieldset className="lifi-fields" disabled={busy||!!request}><div className="payments-row"><label>ETH to swap<input aria-label="ETH to swap" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Maximum slippage<select aria-label="Native swap slippage" value={slippage} onChange={e=>setSlippage(Number(e.target.value))}><option value={25}>0.25%</option><option value={50}>0.5%</option><option value={100}>1%</option></select></label></div>
 <button disabled={!preparationAvailable||!wallet||!amount||busy||!!request} onClick={()=>void run(async current=>{if(!wallet||!preparationAvailable)return;const d=await api('prepare',{wallet,amount,slippageBps:slippage});if(!current())return;const r=validateLifiRequest(d.request);if(r.deviceId!==wallet.deviceId||r.from.toLowerCase()!==wallet.evmAddress.toLowerCase())throw Error('Prepared wallet differs.');save(r,null);setRequest(r);setResponse(null);setOutcome(null);setReady(false);setMessage('Prepared and saved. Review the exact minimum and gas budget, then export. No funds sent.');})}>{busy?'Checking…':'Prepare ETH → USDC'}</button></fieldset>
 <label>Restore request or recovery record<input type="file" accept=".json" disabled={busy||!wallet} onChange={e=>{const f=e.target.files?.[0];if(f)void run(async current=>{const raw=await read(f);const r=validateLifiRequest(raw.request||raw,Date.now(),false);if(!current()||!wallet)return;if(r.deviceId!==wallet.deviceId||r.from.toLowerCase()!==wallet.evmAddress.toLowerCase())throw Error('Request belongs to a different wallet.');const restored=raw.response?verifyLifiResponse(raw.response,r,wallet,Date.now(),false):null;save(r,restored);setRequest(r);setResponse(restored);setReady(false);setConsent(false);setOutcome(null);setMessage('Request restored. Check any saved transaction before submitting.');});e.target.value='';}}/></label>
 {request&&review&&<><dl className="lifi-review">{[["You pay",review.amount],["Minimum received",review.minimumReceived],["Estimated received",review.estimatedReceived],["Provider fee · included",review.providerFee],["Maximum gas · additional",review.maximumGas],["Maximum total",review.maximumTotal],["Receive at",review.recipient],["Approve before · UTC",review.expiresAt]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><details className="lifi-details"><summary>Contract and approval details</summary><dl className="lifi-review">{[["USDC contract",review.outputContract],["LI.FI contract",review.router],["Ethereum transaction nonce",review.nonce],["Approval fingerprint",review.fingerprint],["Contract identity digest",review.contractIdentities]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details><p className="payments-notice">{review.warning}</p>
 <button disabled={busy} onClick={()=>void run(async()=>{const session=createMacPublicSession(wallet,request);download('unsigned-trade-request.json',session.request);setMessage('Request exported. Review its exact terms on the offline signer before approving.');})}>Export unsigned-trade-request.json</button>
 <details><summary>Review on your Mac</summary><p>Save the public wallet and request together, then import this session in DriveKey Companion. Mac review requires its signed validator. Return here with the offline signed response to check and submit.</p><button disabled={busy} onClick={()=>void run(async()=>{const session=createMacPublicSession(wallet,request);download('drivekey-public-session.json',session);setMessage('Public session exported for Mac review. The original deadline still applies. No approval or funds transferred.');})}>Save for Mac review</button></details>
 <label>Import signed response<input type="file" accept=".json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void run(async current=>{setResponse(null);setReady(false);setConsent(false);setOutcome(null);const raw=await read(f);if(!current()||!wallet)return;const s=verifyLifiResponse(raw,request,wallet,Date.now(),false);save(request,s);setResponse(s);setReady(false);setConsent(false);setOutcome(null);setMessage('Signature and exact transaction verified. Run preflight before submitting.');});e.target.value='';}}/></label>
 {response&&<><p className="payments-address">Transaction: <a href={'https://etherscan.io/tx/'+response.transactionHash} target="_blank" rel="noreferrer">{response.transactionHash}</a></p>
 <button disabled={busy} onClick={()=>download('lifi-recovery.json',{request,response,wallet})}>Save recovery record</button>
 <button disabled={busy} onClick={()=>void run(async current=>{await api('preflight',signed());if(current()){setReady(true);setConsent(false);setMessage(liveExecutionEnabled('lifi')?'Current simulation passed. Review and submit when ready.':'Simulation passed. '+LIVE_RELEASE.reason);}})}>Check before submitting</button>
 <label className="lifi-consent"><input type="checkbox" checked={consent} disabled={busy||!ready||!liveExecutionEnabled('lifi')} onChange={e=>setConsent(e.target.checked)}/> I approve the displayed ETH amount, minimum USDC and maximum gas.</label>
 <button disabled={busy||!ready||!consent||!liveExecutionEnabled('lifi')} onClick={()=>void run(current=>reconcile(true,current))}>{liveExecutionEnabled('lifi')?'Submit this signed swap':'Submit · release verification required'}</button>
 <button disabled={busy} onClick={()=>void run(current=>reconcile(false,current))}>Check transaction outcome</button></>}
 <button disabled={busy} onClick={()=>{if(key)localStorage.removeItem(key);setRequest(null);setResponse(null);setReady(false);setConsent(false);setOutcome(null);setMessage('Form cleared. Any submission journal remains for duplicate protection. Signed bytes are not revoked.');}}>Start another request</button></>}
 <p role="status" aria-live="polite">{busy?'Working… ':''}{message}</p>{outcome&&<p>{outcome.state} · {outcome.finality||'not finalized'}{outcome.deliveryVerified&&outcome.receivedBaseUnits?' · '+formatUnits(outcome.receivedBaseUnits,6)+' USDC delivered':''}</p>}
 </section>;
}
