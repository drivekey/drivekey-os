'use client';
import {useRef,useState} from 'react';
import {HusherOwnerAccess} from './husher-owner-access';
import {husherClientAction} from '@/core/husher-client';
import type {OperatorAlertView} from '@/core/operator-alert-view';
const reason:Record<string,string>={'auth-failed':'Repeated sign-in failures','identity-pin-mismatch':'Contract identity changed','storage-unavailable':'Storage unavailable','reconciliation-stale':'Transaction needs reconciliation','rate-limited':'High request volume'};
const action:Record<string,string>={'inspect-authentication':'Check owner access.','review-program-upgrade':'Review the contract change. Keep execution blocked.','restore-storage':'Check storage and recovery status.','reconcile-without-resending':'Check the saved transaction. Do not resend.','inspect-rate-capacity':'Review traffic and available capacity.'};
export default function OperatorAlertDashboard(){
 const [data,setData]=useState<OperatorAlertView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 const [stream,setStream]=useState<'direct'|'collected'>('direct');
 async function request(command:Record<string,unknown>={action:'read'}){
  const response=await fetch('/api/operator/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,stream}),cache:'no-store',signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Monitoring unavailable.');setData(result);
 }
 async function exclusive(task:()=>Promise<void>){if(lock.current)throw Error('Please wait for the current request.');lock.current=true;setBusy(true);setError('');try{await task();}catch(e){setData(null);throw e;}finally{lock.current=false;setBusy(false);}}
 async function run(command:Record<string,unknown>={action:'read'}){try{await exclusive(()=>request(command));}catch(e){setError(e instanceof Error?e.message:'Monitoring unavailable.');}}
 return <><header className="payments-card"><h1>Operator alerts</h1><p>Private service monitoring</p></header>
 <HusherOwnerAccess onSignIn={code=>exclusive(async()=>{setData(null);await husherClientAction('login',{code});await request();})} onCheckSession={()=>exclusive(()=>request())}/>
 <section className="payments-card" aria-busy={busy}><button disabled={busy} onClick={()=>void run()}>{busy?'Refreshing…':'Refresh alerts'}</button>
 <label>Alert stream <select disabled={busy} value={stream} onChange={event=>{setStream(event.target.value as 'direct'|'collected');setData(null);setError('');}}><option value="direct">Direct observations</option><option value="collected">Collected journal</option></select></label>
 <p>Each stream has its own incidents. Select a stream, then refresh.</p>
 <p role="alert">{error}</p><p role="status">Monitoring coverage is not yet verified. An empty list does not prove the service is healthy.</p>
 {data&&<><p>Last recorded observation: {data.lastObservedAt===null?'None yet':new Date(data.lastObservedAt).toLocaleString()}</p>
 {data.collection&&(data.collection.state==='unavailable'?<p role="alert">Collection status unavailable. Saved incidents are shown below.</p>:<div role="status"><p>{data.collection.captureEnabled?'Capture enabled':'Capture stopped'} · {data.collection.waiting} events waiting</p><p>Journal: {data.collection.recorded.toLocaleString()} / {data.collection.capacity.toLocaleString()} events. {data.collection.capacityStatus==='full'?'Full — new events cannot be recorded.':data.collection.capacityStatus==='near-limit'?'Near capacity — operator action required.':''}</p><p>Checked {new Date(data.collection.checkedAt).toLocaleString()}. This is a snapshot, not continuous monitoring confirmation.</p></div>)}
 <h2>Open incidents · {data.openIncidents.length}</h2>{data.openIncidents.length===0?<p>No open incidents recorded.</p>:<ul>{data.openIncidents.map(i=><li key={i.service+':'+i.reason}><strong>{reason[i.reason]}</strong> · {i.service}</li>)}</ul>}
 <h2>Unread notifications · {data.notifications.length}</h2><p>Marking a notification read does not resolve its incident.</p>
 {data.notifications.length===0?<p>No unread notifications.</p>:<ul>{data.notifications.map(n=><li key={n.id}><strong>{reason[n.reason]}</strong> · {n.service}<p>{n.transition==='opened'?'Incident opened':'Recovery recorded'} — {action[n.action]}</p><button disabled={busy} onClick={()=>void run({action:'acknowledge',id:n.id,revision:data.revision})}>Mark read</button></li>)}</ul>}
 </>}
 <button disabled={busy} onClick={()=>{void exclusive(async()=>{setData(null);await husherClientAction('logout');}).catch(()=>setError('Sign-out could not be confirmed. Your session may remain active.'));}}>Sign out</button>
 </section></>;
}

