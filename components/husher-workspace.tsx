'use client';
import {readStrictPublicJsonFile} from '@/core/strict-public-json';
import {useEffect,useRef,useState} from 'react';
import {HusherOwnerAccess} from './husher-owner-access';
import {husherClientAction as api,HusherSessionExpiredError} from '@/core/husher-client';
import {husherRecoveryView} from '@/core/husher-recovery-view';
import Image from 'next/image';
import {TerminalHeader,TerminalFooter} from './terminal-chrome';
import {isMultiWallet,readPublicWalletFile} from '@/core/app-wallet';
import {FeatureStatus} from './feature-status';
import {usePublicWallet} from './wallet-context';
import {multiPublicSchema,type MultiPublic} from '@/core/multi-protocol';
import {validateHusherDeposit,verifyHusherDepositResponse,husherDepositReview,type HusherDepositRequest} from '@/core/husher-deposit-protocol';
import {withTradeJournal} from '@/core/trade-journal';
import {HUSHER_STANDARD_ACCEPTED} from '@/core/husher-release';
import {HusherQuote} from './husher-quote';
import {WalletPageHeader} from './wallet-page-header';
import {husherOfflineWindowMs,husherRequestDeadlines,requireHusherWindow,HUSHER_MIN_OFFLINE_WINDOW_MS,HUSHER_MAX_REQUEST_WINDOW_MS} from '@/core/husher-timing';
type Signed=ReturnType<typeof verifyHusherDepositResponse>;
type Creation={id:string;state:string;orderId?:string;externalUserId:string;reservationUsdMicros:string};
type Entry={fingerprint:string;orderId:string;hash:string;request:unknown;response:unknown;wallet:unknown};
type Current=()=>void;
class StaleHusherAction extends Error {}
async function file(file:File){return readStrictPublicJsonFile(file,32768);}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function HusherWorkspace({embedded=false}:{embedded?:boolean}={}){
 const shared=usePublicWallet();const historyRevision=useRef(0),actionRevision=useRef(0),running=useRef(false),mounted=useRef(true);
 const sharedIdentity=isMultiWallet(shared.wallet)?JSON.stringify([shared.wallet.deviceId,shared.wallet.evmAddress,shared.wallet.solanaAddress]):'';
 const currentIdentity=useRef(sharedIdentity);currentIdentity.current=sharedIdentity;
 const [wallet,setWallet]=useState<MultiPublic|null>(null),[authenticated,setAuthenticated]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[creations,setCreations]=useState<Creation[]>([]),[entries,setEntries]=useState<Entry[]>([]),[allowance,setAllowance]=useState(''),[id,setId]=useState('');
 const [payout,setPayout]=useState(''),[receive,setReceive]=useState(''),[maximum,setMaximum]=useState(''),[fees,setFees]=useState(''),[createConsent,setCreateConsent]=useState(false),[sendConsent,setSendConsent]=useState(false),[ready,setReady]=useState(false);
 const [request,setRequest]=useState<HusherDepositRequest|null>(null),[response,setResponse]=useState<Signed|null>(null);
 const [offlineMinutes,setOfflineMinutes]=useState(''),[reviewWindowMs,setReviewWindowMs]=useState(HUSHER_MIN_OFFLINE_WINDOW_MS),[tracking,setTracking]=useState(false);
 const measuredDuration=()=>offlineMinutes===''?undefined:Number(offlineMinutes)*60_000;
 useEffect(()=>{actionRevision.current++;setWallet(isMultiWallet(shared.wallet)?shared.wallet:null);resetApproval();},[sharedIdentity]);
 async function history(revision=++historyRevision.current,current?:Current){const data=await api('history');current?.();if(!mounted.current||revision!==historyRevision.current)return;setAuthenticated(true);setCreations(data.creations);setEntries(data.submissions);setAllowance(`$${(Number(data.allowance.reserved)/1e6).toFixed(2)} reserved of $${(Number(data.allowance.ceiling)/1e6).toFixed(2)} this month`);}
 useEffect(()=>{mounted.current=true;const revision=++historyRevision.current;void history(revision).catch(()=>{if(mounted.current&&revision===historyRevision.current)setAuthenticated(false);});return()=>{mounted.current=false;historyRevision.current++;actionRevision.current++;};},[]);
 async function run(fn:(current:Current)=>Promise<void>){
  // React state does not synchronously close the double-click window.
  if(running.current)return;running.current=true;setBusy(true);
  const revision=actionRevision.current,identity=currentIdentity.current;
  const current=()=>{if(!mounted.current||revision!==actionRevision.current||identity!==currentIdentity.current)throw new StaleHusherAction();};
  try{current();await fn(current);}
  catch(e){if(mounted.current&&!(e instanceof StaleHusherAction)){setReady(false);setSendConsent(false);setCreateConsent(false);if(e instanceof HusherSessionExpiredError){historyRevision.current++;actionRevision.current++;setAuthenticated(false);resetApproval();setCreations([]);setEntries([]);}setMessage(e instanceof Error?e.message:'Action stopped.');}}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 function resetApproval(){setRequest(null);setResponse(null);setReady(false);setSendConsent(false);setCreateConsent(false);setReviewWindowMs(HUSHER_MIN_OFFLINE_WINDOW_MS);setId('');setTracking(false);}
 async function create(current:Current){
  if(!wallet||!createConsent||!HUSHER_STANDARD_ACCEPTED)throw Error('Owner consent and an accepted route are required.');
  husherOfflineWindowMs(measuredDuration());setCreateConsent(false);
  if(!navigator.locks)throw Error('Browser coordination is unavailable.');
  await navigator.locks.request('drivekey-husher-create',{mode:'exclusive'},async()=>{
   current();
   const plan={version:1,route:'eth-usdc',orderType:'normal',privacy:false,id:crypto.randomUUID(),payoutAddress:payout,refundAddress:wallet.evmAddress,exactReceiveAmount:receive,maximumSendAmount:maximum,maximumProviderFees:fees};
   // Write locally before the request. The server's atomic ledger is authoritative.
   const key='drivekey-husher-create-intent',text=JSON.stringify({plan,wallet});
   if(localStorage.getItem(key))throw Error('A local creation intent exists. Refresh and reconcile it before creating another order.');
   localStorage.setItem(key,text);if(localStorage.getItem(key)!==text)throw Error('Creation intent could not be saved.');
   setId(plan.id);const result=await api('create',{plan,wallet,consent:true});current();await history(undefined,current);current();
   if(result.state==='created'){localStorage.removeItem(key);setMessage('Order created. No funds sent. Prepare the exact offline request next.');}
   else setMessage('Creation outcome is uncertain. Recover this intent; do not create again.');
  });
 }
 async function prepare(chosen:string,current:Current){if(!wallet)throw Error('Import the public wallet first.');husherOfflineWindowMs(measuredDuration());resetApproval();const data=await api('prepare',{id:chosen,wallet,measuredOfflineDurationMs:measuredDuration()});current();const r=validateHusherDeposit(data.request,Date.now(),false);if(r.payment.deviceId!==wallet.deviceId||r.payment.from.toLowerCase()!==wallet.evmAddress.toLowerCase())throw Error('Prepared wallet differs.');const savedWindow=data.offlineWindowMs??HUSHER_MIN_OFFLINE_WINDOW_MS;if(!Number.isSafeInteger(savedWindow)||savedWindow<HUSHER_MIN_OFFLINE_WINDOW_MS||savedWindow>=HUSHER_MAX_REQUEST_WINDOW_MS)throw Error('Invalid saved offline review window.');setReviewWindowMs(savedWindow);setId(chosen);setRequest(r);setMessage('Check the order, export it, then approve offline. After rebooting, import the signed response.');}
 async function submit(current:Current){
  if(!wallet||!request||!response||!ready||!sendConsent)throw Error('Verify, preflight and approve the exact signed transaction first.');
  const verified=verifyHusherDepositResponse(response,request,wallet),scope='ethereum:'+wallet.evmAddress.toLowerCase();
  setSendConsent(false);setReady(false);
  await withTradeJournal(scope,verified.transactionHash,request.fingerprint,async store=>{
   current();if(await store.read())throw Error('A submission intent already exists. Reconcile it; never resend.');current();
   const input={request,response:verified,wallet};const checked=await api('preflight',input);current();if(checked.state!=='ready'||checked.hash!==verified.transactionHash||!checked.submissionEnabled)throw Error('Fresh preflight did not pass.');
   await store.write({hash:verified.transactionHash,fingerprint:request.fingerprint,state:'unknown'});const saved=await store.read();current();if(saved?.hash!==verified.transactionHash||saved.state!=='unknown')throw Error('Submission journal did not persist.');
   const result=await api('submit',{...input,consent:true});if(result.hash!==verified.transactionHash)throw Error('Submission identity uncertain. Recover the exact hash.');
   if(result.state==='submitted')await store.write({hash:verified.transactionHash,fingerprint:request.fingerprint,state:'submitted'});
   current();
   setMessage(result.state==='submitted'?'Deposit submitted. Confirmation, finality and Husher payout are separate.':'Submission outcome uncertain. Reconcile the exact hash; never resend.');
   setTracking(true);
  });await history(undefined,current);
 }
 async function recover(entry:Entry,current:Current){const r=validateHusherDeposit(entry.request,Date.now(),false),w=multiPublicSchema.parse(entry.wallet),s=verifyHusherDepositResponse(entry.response,r,w,Date.now(),false);const result=await api('status',{fingerprint:r.fingerprint});current();
  const view=husherRecoveryView(result,r,s.transactionHash);
  await withTradeJournal('ethereum:'+w.evmAddress.toLowerCase(),s.transactionHash,r.fingerprint,async store=>{current();const state=view.deposit.state;if(state!=='unknown')await store.write({hash:s.transactionHash,fingerprint:r.fingerprint,state});});current();
  setMessage(view.message);setTracking(true);
 }
 const review=request?husherDepositReview(request,false):null;
 const content=<><WalletPageHeader title="Husher" description="ETH → USDC on Ethereum" as={embedded?'h2':'h1'} icon={<Image src="/brand/husher-mark.png" width={28} height={28} alt="" unoptimized/>}/><FeatureStatus feature="husher"/>
 {!HUSHER_STANDARD_ACCEPTED&&<p role="status">Execution remains disabled while acceptance checks are in progress.</p>}
 <nav aria-label="Exchange steps"><ol style={{display:'flex',flexWrap:'wrap',gap:'0.75rem 2rem',paddingLeft:'1.25rem'}}>{['Quote','Review order','Approve offline','Submit deposit','Track payout'].map((step,index)=><li key={step} aria-current={index===(tracking?4:response?3:request?2:id?1:0)?'step':undefined}>{step}</li>)}</ol></nav>
 <p role="status" aria-live="polite">{message}</p>
 <HusherQuote onUse={authenticated&&!busy&&!request?q=>{if(running.current)return;resetApproval();setReceive(q.receiveAmount);setMaximum(q.sendAmount);setFees(q.suggestedFeeCeiling);setMessage('Quote copied to the order draft. Review the limits and payout address. No order created.');}:undefined}/>
 {!authenticated?<HusherOwnerAccess onSignIn={async code=>{historyRevision.current++;await api('login',{code});await history();setMessage('Owner session active for 30 minutes.');}} onCheckSession={async()=>{await history();setMessage('Owner session restored.');}}/>:<>
 <section className="payments-card"><h2>Create order</h2><p>{allowance}</p><details><summary>How the monthly limit works</summary><p>Reservations include a valuation buffer and stay allocated after uncertainty or expiry.</p></details><label>Public wallet file<input type="file" accept=".json" disabled={busy||!!request} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async current=>{const w=multiPublicSchema.parse(await readPublicWalletFile(f));current();shared.importWallet(w);resetApproval();setWallet(w);});}}/></label><p>Refund wallet: <code className="dk-full-address">{wallet?.evmAddress||'Import wallet-multi-public.json'}</code></p>
 <label>Receive exactly (USDC)<input inputMode="decimal" value={receive} disabled={busy} onChange={e=>{resetApproval();setReceive(e.target.value);}}/></label><label>Maximum deposit (ETH)<input inputMode="decimal" value={maximum} disabled={busy} onChange={e=>{resetApproval();setMaximum(e.target.value);}}/></label><label>Maximum provider + withdrawal fees (USDC)<input inputMode="decimal" value={fees} disabled={busy} onChange={e=>{resetApproval();setFees(e.target.value);}}/></label><label>Full payout address<input value={payout} spellCheck={false} disabled={busy} onChange={e=>{resetApproval();setPayout(e.target.value);}}/></label>
 <details><summary>Time for offline approval</summary><p>At least 15 minutes must remain. If your measured reboot, review and return takes longer, we reserve that time plus 2 minutes.</p><label>Measured round trip (minutes, optional)<input type="number" min="1" max="27" step="1" value={offlineMinutes} disabled={busy} onChange={e=>{setOfflineMinutes(e.target.value);setReady(false);setSendConsent(false);setCreateConsent(false);}}/></label><p>The approval limit is 30 minutes. Provider deadlines are never extended.</p></details>
 <p className="payments-notice">Husher holds your deposit until payout or refund. This standard exchange does not use private routing.</p><label><input type="checkbox" checked={createConsent} disabled={busy||!wallet||!HUSHER_STANDARD_ACCEPTED} onChange={e=>setCreateConsent(e.target.checked)}/>Create one order with these limits. No funds sent yet.</label><button disabled={busy||!wallet||!createConsent||!HUSHER_STANDARD_ACCEPTED} onClick={()=>void run(create)}>Create order</button></section>
 <section className="payments-card"><h2>Approve offline</h2><p>Check the exact order and deadline. Expiry does not revoke a signed ETH deposit.</p>{creations.map(c=><div key={c.id}><p><code className="dk-full-address">{c.id}</code> · {c.state} · {c.orderId||'Order identity unresolved'}</p>{c.orderId?<button disabled={busy||!wallet} onClick={()=>void run(current=>prepare(c.id,current))}>Review saved order</button>:<button disabled={busy} onClick={()=>void run(async current=>{const result=await api('recover-create',{id:c.id});current();if(result.state==='created'){const key='drivekey-husher-create-intent',raw=localStorage.getItem(key);if(raw&&JSON.parse(raw).plan?.id===c.id)localStorage.removeItem(key);}await history(undefined,current);current();setMessage(result.state+' — creation is never retried.');})}>Recover creation</button>}</div>)}
 {review&&<><dl className="asset-review">{Object.entries(review).map(([key,value])=><div key={key}><dt>{key}</dt><dd className="dk-full-address">{String(value)}</dd></div>)}</dl><button disabled={busy} onClick={()=>void run(async()=>{const r=validateHusherDeposit(request);requireHusherWindow(husherRequestDeadlines(r),Date.now(),Math.max(reviewWindowMs,husherOfflineWindowMs(measuredDuration())),'offline');download('unsigned-trade-request.json',r);setMessage('Exported. Open Swap in offline DriveKey RC19 or later, review and sign, then reboot to import your response.');})}>Export offline request</button><label>signed-trade-response.json<input type="file" accept=".json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async current=>{setResponse(null);setReady(false);setSendConsent(false);const raw=await file(f);current();setResponse(verifyHusherDepositResponse(raw,request,wallet,Date.now(),false));setMessage('Response verified. Nothing sent.');});}}/></label></>}
 {response&&<><h3>Submit deposit</h3><p>Transaction: <code className="dk-full-address">{response.transactionHash}</code></p><button disabled={busy} onClick={()=>void run(async current=>{setReady(false);setSendConsent(false);const result=await api('preflight',{request,response,wallet});current();if(result.hash!==response.transactionHash||result.state!=='ready')throw Error('Preflight did not pass.');setReady(result.submissionEnabled===true&&HUSHER_STANDARD_ACCEPTED);setMessage(result.submissionEnabled&&HUSHER_STANDARD_ACCEPTED?'Exact simulation and provider checks passed. Explicit submission is required.':'Checks passed. Submission requires release verification and pilot approval.');})}>Check current conditions</button><button disabled={busy} onClick={()=>void run(async current=>{setReady(false);setSendConsent(false);const result=await api('recover-submission',{request,response,wallet});current();if(result.hash!==response.transactionHash||result.canResubmit!==false||result.exchangeSettlementVerified!==false)throw Error('Recovery identity could not be verified.');const state=result.journalState==='shared-only'?'Submission interrupted: transaction reserved, provider record missing.':result.journalState==='not-claimed'?'No matching submission record.':'Saved transaction found.';setMessage(`${state} Deposit: ${result.depositReadFailed?'check unavailable':result.deposit?.state||'not checked'}. Payout not verified. Do not resend.`);})}>Check interrupted submission</button><label><input type="checkbox" checked={sendConsent} disabled={busy||!ready} onChange={e=>setSendConsent(e.target.checked)}/>I approve sending this exact ETH deposit and its maximum network fees to the reviewed provider address.</label><button disabled={busy||!ready||!sendConsent||!HUSHER_STANDARD_ACCEPTED} onClick={()=>void run(submit)}>Submit exact deposit</button></>}
 </section><section className="payments-card"><h2>Track payout</h2><button disabled={busy} onClick={()=>void run(current=>history(undefined,current))}>Refresh</button>{entries.map(e=><div key={e.fingerprint}><p>{e.orderId} · <code className="dk-full-address">{e.hash}</code></p><button disabled={busy} onClick={()=>void run(current=>recover(e,current))}>Verify deposit and payout</button><button disabled={busy} onClick={()=>download('husher-recovery-'+e.orderId+'.json',e)}>Export recovery record</button></div>)}<details><summary>Pending deposits and refunds</summary><p>A missing receipt does not mean a deposit was never sent. Refunds need matching on-chain evidence before they can be verified.</p></details></section>
 <button disabled={busy} onClick={()=>void run(async current=>{await api('logout');current();historyRevision.current++;actionRevision.current++;setAuthenticated(false);resetApproval();setCreations([]);setEntries([]);})}>End owner session</button></>}
 <details><summary>Offline signer and other providers</summary><p><a href="/app/setup">Offline release status</a>{!embedded&&<> · <a href="/app/swap?provider=husher">All swap providers</a></>}</p></details></>;
 return embedded?content:<div className="terminal-app"><TerminalHeader/><main id="main" className="payments-shell">{content}</main><TerminalFooter/></div>;
}
