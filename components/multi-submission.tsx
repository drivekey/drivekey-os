"use client";
import {useEffect,useRef,useState} from 'react';
import {verifyMultiResponse,type MultiPublic,type MultiRequest,type MultiResponse} from '@/core/multi-protocol';
import {submitBrowserTrade,recoverBrowserTrade} from '@/core/trade-client-submission';
type Attempt={hash:string;fingerprint:string;state:string};
const keyFor=(w:MultiPublic,r:MultiRequest)=>`drivekey-multi-attempt:${w.deviceId}:${r.network}`;
async function call(input:unknown){const r=await fetch('/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok||data.error)throw Error(data.error||'Action failed.');return data;}
function read(key:string):Attempt|null{const raw=localStorage.getItem(key);if(!raw)return null;if(raw.length>2000)throw Error('Invalid submission record.');const a=JSON.parse(raw);if(typeof a.hash!=='string'||typeof a.fingerprint!=='string'||!['unknown','submitted','pending','confirmed','failed','not-seen','verified-only','expired'].includes(a.state))throw Error('Invalid submission record.');return a;}
export function assertNoPendingMulti(w:MultiPublic,network:string){const raw=localStorage.getItem(`drivekey-multi-attempt:${w.deviceId}:${network}`);if(raw)throw Error('A previous submission record exists. Reconcile it and explicitly release the record before preparing another transfer.');}
export function MultiSubmission({wallet,request,response}:{wallet:MultiPublic;request:MultiRequest;response:MultiResponse}){
 const [attempt,setAttempt]=useState<Attempt|null>(null),[enabled,setEnabled]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[storageError,setStorageError]=useState(false);
 const key=keyFor(wallet,request);
 const identity=JSON.stringify([wallet,request,response]),current=useRef(identity),generation=useRef(0),mounted=useRef(false),inFlight=useRef<number|null>(null);
 current.current=identity;
 type Check=()=>void;
 useEffect(()=>{mounted.current=true;generation.current++;inFlight.current=null;setBusy(false);setEnabled(false);setConsent(false);setAttempt(null);setStorageError(false);setMessage('');return()=>{mounted.current=false;generation.current++;inFlight.current=null;};},[identity]);
 useEffect(()=>{try{setAttempt(read(key));}catch{setStorageError(true);setMessage('Submission record unreadable. Sending is blocked.');}},[key,identity]);
 async function persist(a:Attempt|null,check:Check,expected:string|null){check();if(!navigator.locks)throw Error('Web Locks required for recovery storage.');await navigator.locks.request('drivekey-multi-recovery:'+key,async()=>{check();if(localStorage.getItem(key)!==expected)throw Error('Submission recovery changed in another tab. Reload and reconcile.');const raw=a?JSON.stringify(a):null;if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw Error('Could not persist submission intent.');check();setAttempt(a);});check();}
 async function run(fn:(check:Check)=>Promise<void>){if(inFlight.current!==null)return;const owner=generation.current,expected=identity;const check=()=>{if(!mounted.current||generation.current!==owner||current.current!==expected)throw Error('Transfer context changed. Reconcile any prior attempt.');};inFlight.current=owner;setBusy(true);try{check();await fn(check);}catch(e){try{check();setMessage(e instanceof Error?e.message:'Stopped.');}catch{/* Old operation cannot repaint new context. */}}finally{if(inFlight.current===owner){inFlight.current=null;try{check();setBusy(false);}catch{}}}}
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key!==null&&event.key!==key)return;generation.current++;inFlight.current=null;setBusy(false);setEnabled(false);setConsent(false);try{setAttempt(read(key));}catch{setStorageError(true);}setMessage('Submission recovery changed in another tab. Reload and reconcile.');};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[key]);
 const input={wallet,request,response};
 const normalize=(r:{state:string;hash:string;[key:string]:unknown})=>({...r,state:r.state==='pending'?'submitted':r.state==='not-seen'?'unknown':r.state});
 const status=async(check:Check)=>{check();const result=normalize(await call({action:'status',...input}));check();return result;};
 async function send(check:Check){
  check();
  if(!consent||!enabled||storageError)throw Error('Explicit consent and path acceptance are required.');
  let expected=localStorage.getItem(key);const previous=read(key);if(previous)throw Error('Previous attempt exists. Reconcile it; do not resend.');
  const result=await submitBrowserTrade({...input,consent}, {preflight:async()=>{check();const r=await call({action:'preflight',...input});check();if(!r.broadcastEnabled)throw Error('Submission is disabled.');return r;},status:()=>status(check),submit:async()=>{check();await persist({hash:response.transactionHash,fingerprint:request.fingerprint,state:'unknown'},check,expected);expected=JSON.stringify({hash:response.transactionHash,fingerprint:request.fingerprint,state:'unknown'});check();const result=normalize(await call({action:'broadcast',...input,consent:true}));check();return result;}},enabled);
  check();await persist({hash:response.transactionHash,fingerprint:request.fingerprint,state:result.state},check,expected);setMessage(result.message||('Transaction '+result.state+('finality' in result&&result.finality?' · '+result.finality:'')));
 }
 const matching=!attempt||(attempt.hash===response.transactionHash&&attempt.fingerprint===request.fingerprint);
 return <section aria-label="Exact submission"><button disabled={busy||storageError||!!attempt} onClick={()=>void run(async(check)=>{setEnabled(false);setConsent(false);check();const r=await call({action:'preflight',wallet,request,response});check();setEnabled(r.broadcastEnabled===true);setMessage(r.message);})}>Check current network conditions</button>
 <p role="status">{message}</p>{attempt&&<p>Submission record: {attempt.state} / <code>{attempt.hash}</code>. {matching?'':'This belongs to another request. Restore its saved request and response to reconcile it.'}</p>}
 {!attempt&&<><label><input type="checkbox" checked={consent} disabled={!enabled||busy} onChange={e=>setConsent(e.target.checked)}/>I authorize submitting this exact signed transfer and its fees.</label><button disabled={!enabled||!consent||busy||storageError} onClick={()=>void run(send)}>Submit exact signed transaction</button></>}
 {attempt&&matching&&<button disabled={busy} onClick={()=>void run(async(check)=>{const expected=JSON.stringify(attempt);if(localStorage.getItem(key)!==expected)throw Error('Submission recovery changed in another tab. Reload and reconcile.');const r=await recoverBrowserTrade(input,()=>status(check));check();await persist({...attempt,state:r.state},check,expected);setMessage(`Exact hash status: ${r.state}${r.finality ? ' · '+r.finality : ''}. Not-seen does not prove a transaction was never submitted.`);})}>Reconcile exact hash</button>}
 {attempt&&matching&&['confirmed','failed','verified-only','expired'].includes(attempt.state)&&<button disabled={busy} onClick={()=>void run(async(check)=>{const expected=JSON.stringify(attempt);await persist(null,check,expected);setEnabled(false);setConsent(false);setMessage('Record released. Prepare a fresh request; do not reuse the old signature.');})}>Release reconciled record</button>}
 <p>Submission requires verification for this specific network and asset path. No automatic resend after reload or timeout.</p></section>;
}



