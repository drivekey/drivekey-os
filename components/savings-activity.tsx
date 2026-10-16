'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ChevronDown,Clock3,FileSearch,LockKeyhole,Upload,X} from 'lucide-react';
import {formatUnits,ZeroAddress} from 'ethers';
import type {SavingsLifecycleInput,SavingsLifecycleResult,SavingsEffectiveStatus} from '@/core/savings-lifecycle';

const labels:Record<SavingsEffectiveStatus,{title:string;copy:string}>={
 'unknown':{title:'Outcome unknown',copy:'The record is missing or inconsistent. Check again before taking another action.'},
 'not-queued':{title:'Not queued',copy:'There is no matching queue receipt in this record. The waiting period has not been established.'},
 'waiting':{title:'Waiting period reported',copy:'The reported queue receipt starts the waiting period.'},
 'ready':{title:'Ready time reached',copy:'The imported record reports that the waiting period ended. Execution is still a separate transaction.'},
 'expired':{title:'Approval expired',copy:'The imported block is past the signed deadline. This approval cannot be reused.'},
 'invalidated':{title:'Approval no longer current',copy:'A later security change invalidated this approval, according to the record.'},
 'executed':{title:'Completion reported',copy:'The transaction and its outcome match this record. Network finality has not been independently verified.'},
 'cancelled':{title:'Cancellation reported',copy:'The cancellation and action state match this record. Network finality has not been independently verified.'},
 'outcome-unverified':{title:'Outcome needs a receipt',copy:'The state reports a completed action, but its matching receipt is missing.'},
};
type RecordView={fileName:string;input:SavingsLifecycleInput;result:SavingsLifecycleResult};
const actionNames=['Withdrawal','Signer or protection change','Resume savings'] as const;
function utc(seconds:number){const date=new Date(seconds*1000);return Number.isFinite(date.getTime())?date.toISOString().replace('T',' ').replace('.000Z',' UTC'):'Time unavailable';}

export default function SavingsActivity(){
 const [record,setRecord]=useState<RecordView|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 function clear(){generation.current++;setRecord(null);setMessage('');setBusy(false);}
 async function load(file?:File){
  if(!file)return;const operation=++generation.current;setRecord(null);setMessage('');setBusy(true);
  try{
   if(!file.name.toLowerCase().endsWith('.json')||file.size>131072)throw Error('Choose a public JSON record up to 128 KB.');
   const [{parseSavingsLifecyclePublicFile,savingsLifecycleInputSchema,reduceSavingsLifecycle},bytes]=await Promise.all([
    import('@/core/savings-lifecycle'),file.arrayBuffer(),
   ]);
   const input=savingsLifecycleInputSchema.parse(parseSavingsLifecyclePublicFile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)));
   const result=reduceSavingsLifecycle(input);
   if(operation!==generation.current)return;
   setRecord({fileName:file.name,input,result});
  }catch{if(operation===generation.current)setMessage('Could not read this activity record. Choose a public savings lifecycle JSON file up to 128 KB. Previous status has been cleared.');}
  finally{if(operation===generation.current)setBusy(false);}
 }
 const action=record?.input.queue.expected.operation.kind==='queue'?record.input.queue.expected.operation.action:null;
 const status=record?labels[record.result.status]:null;
 return <details className="savings-disclosure savings-activity">
  <summary><span><FileSearch size={16}/>Review savings activity</span><ChevronDown size={15}/></summary>
  <div className="savings-activity-body" aria-busy={busy}>
   <div className="savings-section-heading"><h2>Savings activity</h2><span className="savings-stage">Read-only preview</span></div>
   <p className="savings-muted">Check a public transaction record. Live network state is not verified here.</p>
   <div className="savings-activity-controls"><label className="savings-upload savings-secondary"><Upload size={15}/>{busy?'Reading…':'Open activity record'}<input aria-label="Open public savings activity record" type="file" accept=".json,application/json" onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
    {(record||busy||message)&&<button className="savings-back" onClick={clear}><X size={14}/>Clear record</button>}
   </div>
   {message&&<p className="savings-message" role="alert">{message}</p>}
   {record&&status&&action&&<article className="savings-activity-card" aria-label="Imported savings activity" data-status={record.result.status}>
    <div className="savings-activity-top"><span><LockKeyhole size={14}/>{actionNames[action.kind]}</span><span>Source not verified</span></div>
    <div role="status" className="savings-activity-status"><h3>{status.title}</h3><p>{status.copy}</p></div>
    {record.result.attemptObservation==='reverted'&&<p className="savings-attempt-note">The latest attempt failed. It did not complete this action.</p>}
    {record.result.countdown&&<div className="savings-wait-summary"><Clock3 size={17}/><div><strong>{record.result.countdown.remainingAtObservedBlock>0?`${Math.ceil(record.result.countdown.remainingAtObservedBlock/60)} min left at the imported block`:'Waiting period ended in the imported record'}</strong><span>Ready at {utc(record.result.countdown.readyAt)}</span></div></div>}
    <dl className="savings-activity-facts">
     {action.kind===0&&<><dt>Amount</dt><dd>{formatUnits(action.amount,action.asset===ZeroAddress?18:6)} {action.asset===ZeroAddress?'ETH':'USDC'} <span>· Ethereum</span></dd><dt>Recipient</dt><dd className="savings-address">{action.recipient}</dd></>}
     <dt>Vault</dt><dd className="savings-address">{record.input.queue.expected.vault}</dd>
     <dt>Approval deadline</dt><dd>{utc(action.expiry)}</dd>
    </dl>
    <details className="savings-disclosure savings-record-details"><summary>Record details<ChevronDown size={14}/></summary><dl className="savings-activity-facts">
     <dt>File</dt><dd className="savings-address">{record.fileName}</dd>
     <dt>State observed at</dt><dd>{utc(record.input.current.block.timestamp)} · block {record.input.current.block.number}</dd>
     <dt>Queue transaction</dt><dd className="savings-address">{record.input.queue.observed.receipt?.transactionHash??'No receipt'}</dd>
     <dt>Action ID</dt><dd className="savings-address">{record.result.actionId??'Unavailable'}</dd>
    </dl><p>{record.result.reason}</p><p>A matching file is not proof of the live network, current state or finality. This view cannot approve, submit or retry a transaction.</p></details>
   </article>}
   {!record&&!message&&!busy&&<div className="savings-activity-empty"><ArrowUpRight size={18}/><span>Choose a public activity JSON file.</span></div>}
  </div>
 </details>;
}
