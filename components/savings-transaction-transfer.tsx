'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {reviewSavingsTransaction,parseSavingsTransactionFile,verifySavingsTransactionResponse,type SavingsTransactionRequest} from '@/core/savings-transaction';
import {emptySavingsTransactionJournal,stageSavingsTransaction,restoreSavingsTransactionJournal,markSavingsSubmissionAttempt,type SavingsTransactionJournal} from '@/core/savings-transaction-journal';
import {savingsLocalCall,type SavingsLocalResult} from './savings-rehearsal-client';
export function saveSavingsPublicFile(value:unknown,name:string){const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export async function readSavingsPublicFile(file:File,limit=32768){if(!file.name.toLowerCase().endsWith('.json')||file.size<1||file.size>limit)throw Error('Choose a bounded public JSON file.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}
type Props={request:SavingsTransactionRequest;local?:boolean;onObserved?:(result:SavingsLocalResult)=>void;onExecution?:(result:SavingsLocalResult)=>void};
const labels={
 'submission-uncertain':'Submission outcome is unknown. Reconcile this exact transaction; do not submit it again.',
 'reconciliation-required':'The local receipt needs reconciliation. No completion is claimed.',
 'reverted':'The local transaction reverted. The action did not complete; gas may have been consumed.',
 'local-vault-created':'Pinned contract and initial policy matched on the local rehearsal chain. Independent enrollment is still required.',
 'local-action-queued':'Action queued on the local rehearsal chain. Its waiting period started in the queue block.',
 'local-operation-observed':'The exact operation and receipt matched on the local rehearsal chain.',
} as const;
export default function SavingsTransactionTransfer({request,local=false,onObserved,onExecution}:Props){
 const [journal,setJournal]=useState<SavingsTransactionJournal>(emptySavingsTransactionJournal),[result,setResult]=useState<SavingsLocalResult|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(0);
 const generation=useRef(0),inflight=useRef(false),attempted=useRef(false);useEffect(()=>{setClock(Date.now());const t=setInterval(()=>setClock(Date.now()),1000);return()=>{clearInterval(t);generation.current++;};},[]);
 const entry=journal.entries[0];let review:ReturnType<typeof reviewSavingsTransaction>|null=null;try{review=reviewSavingsTransaction(request,clock||Date.now());}catch{/* No export or fresh submission after expiry. */}
 async function open(file:File|undefined,restore=false){
  if(!file||inflight.current||attempted.current)return;inflight.current=true;const id=++generation.current;setBusy(true);setResult(null);setMessage('');setJournal(emptySavingsTransactionJournal());
  try{const raw=await readSavingsPublicFile(file,restore?262144:32768);if(id!==generation.current)return;
   if(restore){const j=restoreSavingsTransactionJournal(raw).journal;if(j.entries.length!==1||j.entries[0].request.fingerprint!==request.fingerprint)throw Error('Open the record for this exact prepared transaction.');attempted.current=true;setJournal(j);setMessage('Record revalidated. Reconciliation is required; restored status never authorizes a retry.');}
   else {const response=verifySavingsTransactionResponse(parseSavingsTransactionFile(raw),request);setJournal(stageSavingsTransaction(emptySavingsTransactionJournal(),request,response));setMessage('Exact gas signature verified. Nothing submitted.');}
  }catch(e){if(id===generation.current)setMessage(e instanceof Error?e.message:'Public file rejected.');}finally{if(id===generation.current){inflight.current=false;setBusy(false);}}
 }
 async function run(action:'submit'|'reconcile'|'prepare-execution'){
  if(!entry||!local||inflight.current||(action==='submit'&&attempted.current))return;inflight.current=true;const id=++generation.current;setBusy(true);setMessage('');
  try{
   // UI fail-closed marker; the server separately fsyncs an exclusive public
   // nonce claim before any RPC write. Interrupted requests are never retried.
   if(action==='submit'){attempted.current=true;setJournal(markSavingsSubmissionAttempt(journal,entry.response.transactionHash));}
   const next=await savingsLocalCall(action,{request:entry.request,response:entry.response});if(id!==generation.current)return;
   if(action==='prepare-execution'){onExecution?.(next);return;}
   setResult(next);setMessage(next.status?labels[next.status]:'Local observation returned.');onObserved?.(next);
  }catch(e){if(id===generation.current)setMessage(action==='submit'?'Submission not confirmed. Use Reconcile; do not submit again.':e instanceof Error?e.message:'Local check failed.');}
  finally{if(id===generation.current){inflight.current=false;setBusy(false);}}
 }
 return <div aria-busy={busy}>
  {review?<><dl className="savings-details">{review.rows.filter(v=>['Purpose','Gas wallet','Maximum network fee','Savings vault','Protection'].includes(v.label)).map(v=><div key={v.label}><dt>{v.label}</dt><dd>{v.value}</dd></div>)}</dl>
   <details className="savings-disclosure"><summary>Exact network transaction</summary><dl className="savings-details">{review.rows.map((v,i)=><div key={i}><dt>{v.label}</dt><dd>{v.value}</dd></div>)}</dl><p>A review deadline cannot revoke signed Ethereum transaction bytes.</p></details>
   <div className="savings-activity-controls"><button type="button" className="savings-secondary" disabled={busy} onClick={()=>{try{reviewSavingsTransaction(request);saveSavingsPublicFile(request,'savings-transaction-request.json');}catch{setClock(Date.now());setMessage('Request expired. Prepare a fresh gas approval.');}}}><Download size={15}/>Save gas request</button>
   <label className="savings-upload savings-secondary"><Upload size={15}/>Add signed gas response<input aria-label="Savings signed gas response" disabled={busy||!!entry?.submissionAttempted} type="file" accept=".json,application/json" onChange={e=>{void open(e.target.files?.[0]);e.target.value='';}}/></label></div>
  </>:<p role="alert" className="savings-message">Review expired. Reconcile any existing signed transaction before preparing another.</p>}
  {entry&&<><p className="savings-address">Transaction: {entry.response.transactionHash}</p><div className="savings-activity-controls">
   <button type="button" className="savings-secondary" onClick={()=>saveSavingsPublicFile(journal,'savings-transaction-journal.json')}><Download size={15}/>Save public transaction record</button>
   {local&&<><button type="button" className="savings-secondary" disabled={busy||!review||entry.submissionAttempted} onClick={()=>void run('submit')}>Submit to local rehearsal</button>
    <button type="button" className="savings-secondary" disabled={busy} onClick={()=>void run('reconcile')}>Reconcile exact transaction</button></>}
  </div></>}
  <label className="savings-upload savings-back">Open public transaction record<input aria-label="Restore savings transaction journal" disabled={busy||!!entry?.submissionAttempted} type="file" accept=".json,application/json" onChange={e=>{void open(e.target.files?.[0],true);e.target.value='';}}/></label>
  {result?.queue&&result.queue.status==='queued'&&<div className="savings-activity-card"><strong>Waiting on the local chain</strong><p>Ready at {new Date(result.queue.readyAt*1000).toISOString()}. Expires at {new Date(result.queue.expiry*1000).toISOString()}.</p><p className="savings-muted">Execution needs a separate offline gas approval. The contract checks the delay, current policy, pause state and expiry again.</p><button type="button" className="savings-secondary" disabled={busy||clock<result.queue.readyAt*1000||clock>=result.queue.expiry*1000} onClick={()=>void run('prepare-execution')}>Prepare execution gas approval</button></div>}
  {message&&<p role="status" className="savings-message">{message}</p>}
 </div>;
}
