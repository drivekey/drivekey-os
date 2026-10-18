"use client";
import {useEffect,useRef,useState} from "react";
import {withTradeJournal} from '@/core/trade-journal';
import {keccak256} from 'ethers';
import {Buffer} from "buffer";
import type {PublicKey,Transaction} from "@solana/web3.js";
import type {MultiPublic} from "@/core/multi-protocol";
import {validateNonceQuote,verifyNonceSigned,solDisplay,type NonceQuote} from "@/core/nonce-setup-protocol";

type SponsorProvider={isPhantom?:boolean;publicKey:PublicKey|null;connect:()=>Promise<{publicKey:PublicKey}>;signTransaction:(tx:Transaction)=>Promise<Transaction>};
type Pending={quote:NonceQuote;raw:string;hash:string;submissionRequested?:boolean};
type Result={transactionVerified?:boolean;replacementAllowed?:boolean;state?:string;address?:string;authority?:string;hash?:string;message?:string;setupEnabled?:boolean;quote?:NonceQuote};
async function api(input:unknown):Promise<Result>{
 const response=await fetch("/api/assets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(25_000)});
 const data=await response.json();if(!response.ok||data.error)throw Error(data.error||"Nonce setup failed.");return data;
}
export function NonceSetup({wallet,onReady,disabled=false,onBusy}:{wallet:MultiPublic;onReady:(address:string)=>void;disabled?:boolean;onBusy:(busy:boolean)=>void}){
 const [sponsor,setSponsor]=useState(""),[quote,setQuote]=useState<NonceQuote|null>(null),[pending,setPending]=useState<Pending|null>(null);
 const [consent,setConsent]=useState(false),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [ready,setReady]=useState(""),[resolved,setResolved]=useState(false),[loaded,setLoaded]=useState(false),[blocked,setBlocked]=useState(false);
 const lock=useRef(false),provider=useRef<SponsorProvider|null>(null);
 const revision=useRef(0),operation=useRef(0),mounted=useRef(false),currentWallet=useRef('');
 const walletIdentity=wallet.deviceId+':'+wallet.solanaAddress;currentWallet.current=walletIdentity;
 function current(token:number){if(!mounted.current||revision.current!==token||currentWallet.current!==walletIdentity)throw Error('Wallet or page changed. Review the setup again.');}
 const key="drivekey-nonce-setup-v1:"+wallet.solanaAddress;
 useEffect(()=>{let cancelled=false;mounted.current=true;revision.current++;operation.current++;lock.current=false;setBusy(false);setLoaded(false);setConsent(false);setReady('');setPending(null);setQuote(null);setResolved(false);setBlocked(false);setSponsor('');setEnabled(false);provider.current=null;
  void (async()=>{try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw) as Pending;const verified=await verifyNonceSigned(p.raw,p.quote,wallet);if(verified.hash!==p.hash)throw Error("Saved signature mismatch.");if(!cancelled){setPending(p);setQuote(p.quote);setSponsor(p.quote.sponsor);setMessage("Saved setup attempt restored. Check status; do not pay again.");}}}
   catch{if(!cancelled){setBlocked(true);setMessage("Saved setup record could not be verified. Stop and reconcile it before another payment.");}}
   finally{if(!cancelled)setLoaded(true);}
   try{const r=await api({action:"nonce-capabilities"});if(!cancelled)setEnabled(r.setupEnabled===true);}catch(e){if(!cancelled)setMessage(e instanceof Error?e.message:"Setup status unavailable.");}
  })();return()=>{cancelled=true;mounted.current=false;revision.current++;operation.current++;if(lock.current){lock.current=false;onBusy(false);}};
 },[key,wallet]);
 async function run(action:()=>Promise<void>){if(lock.current||disabled||!loaded||blocked)return;const token=revision.current,id=++operation.current;lock.current=true;setBusy(true);onBusy(true);setMessage("");
  try{await action();}catch(e){if(mounted.current&&revision.current===token)setMessage(e instanceof Error?e.message:"Action stopped.");}finally{if(operation.current===id){lock.current=false;if(mounted.current&&revision.current===token){setBusy(false);onBusy(false);}}}
 }
 function fundingProvider(){const p=(window as unknown as {phantom?:{solana?:SponsorProvider}}).phantom?.solana;if(!p?.isPhantom||!p.signTransaction)throw Error("Open this page in a desktop browser with the Phantom extension. Connect a separate funding wallet, not your USB wallet.");return p;}
 async function connect(){const token=revision.current,p=fundingProvider();const result=await p.connect();current(token);const address=result.publicKey.toBase58();if(address===wallet.solanaAddress)throw Error("This is your offline wallet. Disconnect it and use a separate funding wallet; never import your USB private key.");provider.current=p;setSponsor(address);setQuote(null);setConsent(false);setReady("");}
 async function acceptResult(r:Result,record:Pending|null=pending,token=revision.current){
  current(token);if(record&&r.hash!==record.hash)throw Error('Setup status does not match the saved transaction.');
  if(record&&r.state==='ready'&&r.transactionVerified!==true)throw Error('The original setup transaction is not verified. Reconcile its receipt before continuing.');
  if(record&&((r.state==='ready'&&r.transactionVerified)||r.state==='failed'||r.state==='expired'))await withTradeJournal('solana:'+record.quote.sponsor,record.hash,keccak256(Buffer.from(record.quote.unsignedTransaction,'base64')),store=>store.write({hash:record.hash,fingerprint:keccak256(Buffer.from(record.quote.unsignedTransaction,'base64')),state:r.state==='ready'?'confirmed':r.state==='failed'?'failed':'expired'}));setMessage(r.message||`Setup status: ${r.state||"unavailable"}.`);
  current(token);if(r.state==="ready"&&r.address&&r.authority===wallet.solanaAddress&&(!record||r.address===record.quote.nonceAccount)){setReady(r.address);setResolved(true);setMessage("Nonce account verified on Solana mainnet. Authority matches your offline wallet.");}
  else if((r.state==="failed"||r.state==="expired")&&r.replacementAllowed===true)setResolved(true);
 }
 async function approve(){
  const token=revision.current;
  if(localStorage.getItem(key))throw Error("A setup attempt is already saved in this browser. Reload and check its status before another payment.");
  if(!quote||!consent||pending||!enabled)throw Error("Review the quote and give explicit setup consent first.");
  const q=await validateNonceQuote(quote,wallet,true),p=provider.current||fundingProvider();current(token);
  if(p.publicKey?.toBase58()!==q.sponsor)throw Error("Funding wallet changed. Reconnect and request a fresh quote.");
  const preflight=await api({action:"nonce-preflight",wallet,quote:q});current(token);if(preflight.setupEnabled!==true)throw Error("Nonce setup submission is disabled.");
  const {Transaction}=await import("@solana/web3.js");
  current(token);
  const signed=await p.signTransaction(Transaction.from(Buffer.from(q.unsignedTransaction,"base64")));
  current(token);await validateNonceQuote(q,wallet,true);current(token);
  if(p.publicKey?.toBase58()!==q.sponsor)throw Error("Funding wallet changed during approval. Nothing submitted.");
  const raw=signed.serialize().toString("base64"),verified=await verifyNonceSigned(raw,q,wallet);
  current(token);const record:Pending={quote:q,raw,hash:verified.hash,submissionRequested:false},serialized=JSON.stringify(record);
  localStorage.setItem(key,serialized);if(localStorage.getItem(key)!==serialized)throw Error('Could not save the signed setup. Nothing submitted.');
  setPending(record);setResolved(false);setConsent(false);setMessage('Setup signed and saved. Review the exact cost, then submit when ready.');
 }
 async function submit(){
  const token=revision.current,record=pending;
  if(!record||record.submissionRequested!==false||!enabled||!consent)throw Error('Review the signed setup and approve submission.');
  const q=await validateNonceQuote(record.quote,wallet,true),verified=await verifyNonceSigned(record.raw,q,wallet);current(token);
  const raw=record.raw;
  await withTradeJournal('solana:'+q.sponsor,verified.hash,keccak256(Buffer.from(q.unsignedTransaction,'base64')),async journal=>{
  current(token);
  if(await journal.read())throw Error('This setup has a durable attempt. Check its status; do not resend.');
  await journal.write({hash:verified.hash,fingerprint:keccak256(Buffer.from(q.unsignedTransaction,'base64')),state:'unknown'});
  if((await journal.read())?.hash!==verified.hash)throw Error('Setup intent could not be committed.');
  const submittedRecord={...record,submissionRequested:true},serialized=JSON.stringify(submittedRecord);
  localStorage.setItem(key,serialized);
  if(localStorage.getItem(key)!==serialized)throw Error("Could not save recovery record. Nothing submitted.");
  current(token);setPending(submittedRecord);setResolved(false);setConsent(false);
  try{const result=await api({action:"nonce-submit",wallet,quote:q,raw,consent:true});if(result.hash!==verified.hash)throw Error('Wrong setup receipt.');if(result.transactionVerified||result.state==="failed")await journal.write({hash:verified.hash,fingerprint:keccak256(Buffer.from(q.unsignedTransaction,"base64")),state:result.state==="failed"?"failed":"confirmed"});current(token);setMessage(result.message||`Setup status: ${result.state}. Check setup status before continuing.`);}
  catch{current(token);setMessage("Submission outcome is not confirmed. Use Check setup status; do not pay again.");}
  });
 }
 return <section className="assets-form nonce-setup" aria-label="Guided Solana nonce setup">
  <h2>Enable Solana swaps</h2>
  <p>Pay for setup once with a separate Phantom wallet. Your DriveKey key stays offline.</p>
  <p>The account deposit stays under your offline wallet’s control. Deposit withdrawal is not available in DriveKey yet.</p>
  <dl className="asset-review"><div><dt>Offline authority</dt><dd>{wallet.solanaAddress}</dd></div>{sponsor&&<div><dt>Funding wallet</dt><dd>{sponsor}</dd></div>}</dl>
  {!enabled&&<p>Setup submission is currently locked. You can connect and inspect costs without signing or spending.</p>}
  <button disabled={busy||disabled||!loaded||blocked||!!pending} onClick={()=>void run(connect)}>Connect funding wallet (Phantom)</button>
  <button disabled={busy||disabled||!loaded||blocked||!sponsor||!!pending} onClick={()=>void run(async()=>{
   const token=revision.current;setQuote(null);setConsent(false);setReady("");const r=await api({action:"nonce-prepare",wallet,sponsor});current(token);setEnabled(r.setupEnabled===true);
   if(r.state==="ready"){await acceptResult(r,null,token);return;}const next=await validateNonceQuote(r.quote,wallet,true);current(token);setQuote(next);setMessage("Review the deposit, network fee and offline authority below. Nothing signed.");
  })}>Review setup cost</button>
  {quote&&<><dl className="asset-review">
   <div><dt>Network</dt><dd>Solana mainnet</dd></div><div><dt>Nonce account</dt><dd>{quote.nonceAccount}</dd></div>
   <div><dt>Account deposit · separate from fees</dt><dd>{solDisplay(quote.depositLamports)} SOL</dd></div>
   <div><dt>Network fee</dt><dd>{solDisplay(quote.feeLamports)} SOL</dd></div>
   <div><dt>Total debit from funding wallet</dt><dd>{solDisplay(quote.depositLamports+quote.feeLamports)} SOL</dd></div>
   </dl><p>The quote is short-lived. If it expires, refresh and review it again. Do not reboot during this setup-only step.</p>
   {!pending&&<><label><input type="checkbox" checked={consent} disabled={busy||disabled} onChange={e=>setConsent(e.target.checked)}/>I approve this exact setup deposit and fee, and confirm the offline authority above.</label>
   <button disabled={!consent||busy||disabled||!enabled||blocked} onClick={()=>void run(async()=>{
    if(!navigator.locks)throw Error("This browser cannot safely coordinate setup across tabs. Use a current desktop browser.");
    await navigator.locks.request(key,{ifAvailable:true},async held=>{if(!held)throw Error("Another tab is handling setup. Wait and check its result.");await approve();});
   })}>Approve setup in Phantom</button></>}
  </>}
  {pending&&<><p>Saved transaction: <a href={`https://solscan.io/tx/${pending.hash}`} target="_blank" rel="noreferrer">{pending.hash}</a></p>
   {pending.submissionRequested===false&&<><label><input type="checkbox" checked={consent} disabled={busy||disabled||!enabled} onChange={e=>setConsent(e.target.checked)}/>Submit this exact signed setup and displayed cost.</label><button disabled={busy||disabled||!enabled||!consent} onClick={()=>void run(submit)}>Submit setup</button></>}
   <button disabled={busy||disabled||blocked} onClick={()=>void run(async()=>{const token=revision.current,record=pending;await acceptResult(await api({action:"nonce-status",wallet,quote:record.quote,raw:record.raw}),record,token);})}>Check setup status</button>
   {resolved&&!ready&&<button disabled={busy||disabled} onClick={()=>void run(async()=>{localStorage.removeItem(key);setPending(null);setQuote(null);setConsent(false);setResolved(false);setMessage("Resolved attempt cleared. Recheck costs before a new approval.");})}>Discard resolved attempt</button>}
  </>}
  {ready&&<button disabled={busy||disabled} onClick={()=>void run(async()=>{
   const token=revision.current,r=await api({action:"nonce-check",wallet,address:ready});current(token);if(r.state!=="ready"||r.authority!==wallet.solanaAddress||r.address!==ready)throw Error("Nonce account is not ready.");onReady(ready);setMessage("Solana setup verified. Continue with offline approval.");
  })}>Use verified nonce account</button>}
  <p role="status" aria-live="polite">{busy?"Checking setup…":message}</p>
 </section>;
}
