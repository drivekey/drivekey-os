'use client';
import {useEffect,useRef,useState} from 'react';
import {getAddress,formatUnits,ZeroAddress} from 'ethers';
import {ArrowRight,ChevronDown,Download,FileCheck2,LockKeyhole,Upload,X} from 'lucide-react';
import {savingsReviewExpectationSchema,savingsActionReviewRequestSchema,reviewSavingsAction,type SavingsReviewExpectation,type SavingsActionReviewRequest} from '@/core/savings-action-review';
import {prepareSavingsAction,createSavingsApprovalCollection,addSavingsAuthorization,inspectSavingsApprovalCollection,
  buildSavingsPreparedCall,parseSavingsActionWorkflowFile,type SavingsApprovalCollection} from '@/core/savings-action-workflow';
import SavingsTransaction from './savings-transaction';
import type {MultiPublic} from '@/core/multi-protocol';
import type {SavingsLocalResult} from './savings-rehearsal-client';

type Mode='withdraw'|'configure'|'resume'|'pause'|'cancel';
type Target=Extract<SavingsActionReviewRequest['operation'],{kind:'queue'}>['details'];
function save(value:unknown,name:string){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readPublicFile(file:File){
 if(!file.name.toLowerCase().endsWith('.json')||file.size<1||file.size>32768)throw Error('Choose a public JSON file up to 32 KB.');
 return parseSavingsActionWorkflowFile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()));
}
const errorText=(error:unknown)=>error instanceof Error&&!('issues' in error)?error.message:'Check the public file, exact addresses, amount, nonce and approval deadline.';

/** Public candidate UI; optional submission exists only on the gated local rehearsal. */
export default function SavingsActions({initialExpectation,local=false,initialWallet}:{initialExpectation?:SavingsReviewExpectation;local?:boolean;initialWallet?:MultiPublic}={}){
 const [expectation,setExpectation]=useState<SavingsReviewExpectation|null>(initialExpectation??null),[checked,setChecked]=useState(false);
 const [request,setRequest]=useState<SavingsActionReviewRequest|null>(null),[collection,setCollection]=useState<SavingsApprovalCollection|null>(null);
 const [mode,setMode]=useState<Mode>('withdraw'),[asset,setAsset]=useState<'ETH'|'USDC'>('ETH'),[amount,setAmount]=useState(''),[recipient,setRecipient]=useState('');
 const [nonce,setNonce]=useState(''),[hours,setHours]=useState('2'),[preset,setPreset]=useState<0|1>(1),[members,setMembers]=useState(['','','']);
 const [target,setTarget]=useState<Target|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(0);
 const generation=useRef(0),prepareHeading=useRef<HTMLHeadingElement>(null),reviewHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{const tick=setInterval(()=>setClock(Date.now()),1000);return()=>{clearInterval(tick);generation.current++;};},[]);
 useEffect(()=>{if(request)reviewHeading.current?.focus();else if(checked)prepareHeading.current?.focus();},[request,checked]);
 function discard(){generation.current++;setRequest(null);setCollection(null);setMessage('');setBusy(false);}
 function clear(){
  discard();setExpectation(null);setChecked(false);setTarget(null);setNonce('');
  setMode('withdraw');setAsset('ETH');setAmount('');setRecipient('');setHours('2');setPreset(1);setMembers(['','','']);
 }
 function edit(change:()=>void){discard();change();}
 function acceptRequest(next:SavingsActionReviewRequest,e:SavingsReviewExpectation){
  const initial=createSavingsApprovalCollection(e,next);setRequest(next);setCollection(initial);setClock(Date.now());
 }
 function observed(result:SavingsLocalResult){
  if(!local||!result.identity||!expectation)return;
  if(JSON.stringify(result.identity)!==JSON.stringify(expectation)){
   discard();setExpectation(result.identity);setChecked(false);setTarget(null);setNonce('');
   setMessage('Local operation observed. The vault policy changed; old approvals were cleared. Check the updated candidate before continuing.');
  }
 }
 function execution(result:SavingsLocalResult){
  if(!local||!result.identity||!result.request)return;
  try{const next=savingsActionReviewRequestSchema.parse(result.request);if(next.operation.kind!=='execute')throw Error('Expected an exact queued execution.');discard();setExpectation(result.identity);acceptRequest(next,result.identity);setMessage('Exact queued execution prepared. Approve its gas fee offline.');}
  catch(e){setMessage(errorText(e));}
 }
 async function importIdentity(file?:File){
  if(!file)return;clear();const operation=++generation.current;setBusy(true);
  try{const e=savingsReviewExpectationSchema.parse(await readPublicFile(file));if(operation!==generation.current)return;setExpectation(e);}
  catch{if(operation===generation.current)setMessage('Could not open this vault identity file. Previous identity and approvals were cleared.');}
  finally{if(operation===generation.current)setBusy(false);}
 }
 async function importRequest(file?:File,asTarget=false){
  if(!file||!expectation||!checked)return;discard();if(asTarget)setTarget(null);const operation=++generation.current;setBusy(true);
  try{
   const next=savingsActionReviewRequestSchema.parse(await readPublicFile(file));
   if(next.vault!==expectation.vault||next.runtimeCodeHash!==expectation.runtimeCodeHash)throw Error('This action belongs to a different vault.');
   if(operation!==generation.current)return;
   if(asTarget){
    if(next.operation.kind!=='queue'&&next.operation.kind!=='execute')throw Error('Choose the original withdrawal, signer change or resume request.');
    // Old/expired targets may still be cancelled. The new protective approval
    // receives its own nonce and expiry and is validated by prepareSavingsAction.
    setTarget(next.operation.details);setMode('cancel');
   }else{acceptRequest(next,expectation);setMessage('Prepared action opened. Recheck all details before collecting approvals.');}
  }catch(error){if(operation===generation.current)setMessage(errorText(error));}
  finally{if(operation===generation.current)setBusy(false);}
 }
 function prepare(){
  discard();if(!expectation||!checked)return;
  try{
   if(!['2','6','12','24'].includes(hours))throw Error('Choose an approval duration.');
   const expiry=Math.floor(Date.now()/1000)+Number(hours)*3600;
   let intent:unknown;
   if(mode==='withdraw')intent={kind:mode,asset,amount,recipient,nonce,expiry};
   else if(mode==='configure'){
    const signers=members.slice(0,preset===0?1:3).map(getAddress).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    intent={kind:mode,newConfiguration:{preset,signers},nonce,expiry};
   }else if(mode==='cancel'){
    if(!target)throw Error('Open the exact original action before preparing its cancellation.');
    intent={kind:mode,target,nonce,expiry};
   }else intent={kind:mode,nonce,expiry};
   acceptRequest(prepareSavingsAction(expectation,intent),expectation);
  }catch(error){setMessage(errorText(error));}
 }
 async function importApproval(file?:File){
  if(!file||!expectation||!request||!collection||!checked)return;const operation=++generation.current;setBusy(true);setMessage('');
  try{
   const parsed=await readPublicFile(file);
   if(operation!==generation.current)return;
   if(parsed.kind==='drivekey-savings-approval-collection'){
    inspectSavingsApprovalCollection(parsed,expectation,request);setCollection(parsed);setMessage('Saved signatures rechecked for this exact action. Network state remains unverified.');
   }else{
    setCollection(addSavingsAuthorization(collection,expectation,request,parsed));setMessage('Signature verified for this exact action. Nothing was submitted.');
   }
   setClock(Date.now());
  }catch(error){if(operation===generation.current)setMessage(errorText(error));}
  finally{if(operation===generation.current)setBusy(false);}
 }
 let progress:ReturnType<typeof inspectSavingsApprovalCollection>|null=null,review:ReturnType<typeof reviewSavingsAction>|null=null,unavailable='';
 if(expectation&&request&&collection){try{
  // A public structural review uses a registered identity without choosing or
  // claiming control of an actual signing device. Each imported proof is checked
  // against its own independently recovered signer by the workflow module.
  const now=clock||Date.now();progress=inspectSavingsApprovalCollection(collection,expectation,request,now);
  review=reviewSavingsAction(expectation,request,expectation.configuration.signers[0],now);
 }catch{unavailable='This action expired or no longer matches its approvals. Prepare a fresh action; previous signatures cannot be reused.';}}
 function exportFile(kind:'request'|'identity'|'approvals'|'call'){
  if(!expectation||!request||!collection||!checked)return;
  try{
   inspectSavingsApprovalCollection(collection,expectation,request);
   if(kind==='call')save(buildSavingsPreparedCall(expectation,request,collection),'savings-prepared-call.json');
   else if(kind==='request')save(request,'savings-action-request.json');
   else if(kind==='identity')save(expectation,'savings-review-expectation.json');
   else save(collection,'savings-approval-collection.json');
  }catch(error){setMessage(errorText(error));setClock(Date.now());}
 }
 const details=request?(request.operation.kind==='queue'||request.operation.kind==='execute'?request.operation.details:request.operation.target):null;
 const action=details?.action;
 return <details className="savings-disclosure savings-activity savings-action-workflow">
  <summary><span><FileCheck2 size={16}/>Prepare a savings action</span><ChevronDown size={15}/></summary>
  <div className="savings-activity-body" aria-busy={busy}>
   <div className="savings-section-heading"><h2>Prepare an action</h2><span className="savings-stage">Unfunded preview</span></div>
   <p className="savings-muted">{local?'Rehearse this local vault with synthetic funds. Owner approval and gas signing stay separate.':'Prepare public files for offline approval. Live submission remains unavailable.'}</p>
   <section className="savings-action-section" aria-label="Compare vault identity">
    <h3><span>01</span>Check your vault</h3>
    <div className="savings-activity-controls"><label className="savings-upload savings-secondary"><Upload size={15}/>Open vault identity<input aria-label="Open savings review expectation" type="file" accept=".json,application/json" onChange={e=>{void importIdentity(e.target.files?.[0]);e.target.value='';}}/></label>
     {(expectation||busy||message)&&<button type="button" className="savings-back" onClick={clear}><X size={14}/>Clear all</button>}</div>
    {expectation&&<><dl className="savings-activity-facts"><dt>Network</dt><dd>Ethereum · chain 1</dd><dt>Vault</dt><dd className="savings-address">{expectation.vault}</dd>
     <dt>Protection</dt><dd>{expectation.configuration.preset===0?'Standard · 1 signer':'Strong · 2 of 3 signers'}</dd><dt>Policy</dt><dd>Version {expectation.epoch} · {expectation.paused?'Paused':'Not paused'} <span>· imported claim</span></dd>
     {expectation.configuration.signers.map((signer,i)=><div className="savings-fact-pair" key={signer}><dt>Current signer {i+1}</dt><dd className="savings-address">{signer}</dd></div>)}</dl>
     <p className="savings-muted">{local?'This identity comes from your local test node. It is a rehearsal candidate, not independent trusted enrollment.':'Independently check these details on Ethereum. An imported file cannot confirm current state.'}</p>
     <label className="savings-check"><input type="checkbox" checked={checked} onChange={e=>{discard();setChecked(e.target.checked);}}/>{local?'I checked this synthetic local candidate and understand it is not enrolled for live funds.':'I independently checked this vault and its current policy.'}</label>
    </>}
   </section>
   {expectation&&checked&&!request&&<section className="savings-action-section" aria-label="Prepare exact action">
    <h3 ref={prepareHeading} tabIndex={-1}><span>02</span>Choose an action</h3>
    <fieldset disabled={busy} className="savings-action-fields"><div className="savings-fields">
     <label>Action<select value={mode} onChange={e=>edit(()=>{setMode(e.target.value as Mode);setNonce('');setTarget(null);})}><option value="withdraw">Withdraw to a wallet</option><option value="configure">Change signers or protection</option><option value="resume">Resume savings</option><option value="pause">Pause savings</option><option value="cancel">Cancel an existing action</option></select></label>
     {mode==='withdraw'&&<><label>Asset<select value={asset} onChange={e=>edit(()=>setAsset(e.target.value as 'ETH'|'USDC'))}><option>ETH</option><option>USDC</option></select></label><label>Exact amount<input inputMode="decimal" maxLength={100} value={amount} onChange={e=>edit(()=>setAmount(e.target.value))} placeholder="0.00"/></label><label>Recipient<input maxLength={42} value={recipient} autoComplete="off" spellCheck={false} onChange={e=>edit(()=>setRecipient(e.target.value))} placeholder="0x…"/></label></>}
     {mode==='configure'&&<><label>New protection<select value={preset} onChange={e=>edit(()=>setPreset(Number(e.target.value) as 0|1))}><option value={1}>Strong · 2 of 3</option><option value={0}>Standard · 1 signer</option></select></label>{members.slice(0,preset===0?1:3).map((member,i)=><label key={i}>New signer {i+1}<input maxLength={42} value={member} autoComplete="off" spellCheck={false} placeholder="0x…" onChange={e=>edit(()=>setMembers(old=>old.map((v,j)=>i===j?e.target.value:v)))}/></label>)}<p className="savings-muted">Your current approval threshold still applies. Security changes wait 1 hour. Verify each replacement key and backup independently.</p></>}
     {mode==='cancel'&&<div><label className="savings-upload savings-secondary"><Upload size={15}/>Open original action<input aria-label="Open cancellation target" disabled={busy} type="file" accept=".json,application/json" onChange={e=>{void importRequest(e.target.files?.[0],true);e.target.value='';}}/></label><p className="savings-muted">{target?`Target loaded: ${['withdrawal','signer/protection change','resume'][target.action.kind]}. Its exact terms will appear below.`:'Choose the original request, including all replacement signers for a signer change.'}</p></div>}
     <label>{mode==='pause'||mode==='cancel'?'Protective authorization nonce':'Action nonce'}<input inputMode="numeric" maxLength={78} value={nonce} onChange={e=>edit(()=>setNonce(e.target.value))} placeholder="Exact unused nonce"/></label>
     <label>Approval deadline<select value={hours} onChange={e=>edit(()=>setHours(e.target.value))}><option value="2">2 hours after preparing</option><option value="6">6 hours after preparing</option><option value="12">12 hours after preparing</option><option value="24">24 hours after preparing</option></select></label>
    </div><p className="savings-muted">Use the current unused nonce from Ethereum. Withdrawal waiting starts when the approved action is queued on-chain.</p><details className="savings-disclosure"><summary>Nonce and deadline details<ChevronDown size={15}/></summary><p>Ordinary protective actions and signer-change cancellation use separate nonce sequences. Check the correct sequence independently. The approval deadline does not start the waiting period.</p></details>
    <div className="savings-activity-controls"><button type="button" className="savings-primary" onClick={prepare}>Prepare for offline review<ArrowRight size={15}/></button><label className="savings-upload savings-secondary"><Upload size={15}/>Open prepared action<input aria-label="Open prepared savings action" type="file" accept=".json,application/json" onChange={e=>{void importRequest(e.target.files?.[0]);e.target.value='';}}/></label></div>
    </fieldset>
   </section>}
   {request&&expectation&&checked&&<section className="savings-action-section" aria-label="Collect exact approvals">
    <h3 ref={reviewHeading} tabIndex={-1}><span>03</span>{progress?.requiredApprovals===0?'Review execution':'Collect offline approvals'}</h3>
    <button type="button" className="savings-back" disabled={busy} onClick={()=>{discard();setNonce('');setTarget(null);}}>Start a different action · clears approvals</button>
    {unavailable?<p role="alert" className="savings-message">{unavailable}</p>:review&&progress&&<>
     <div className="savings-activity-card"><div className="savings-activity-top"><span><LockKeyhole size={14}/>{review.purpose}</span><span>Network state unverified</span></div>
      <dl className="savings-activity-facts">{action?.kind===0&&<><dt>Exact amount</dt><dd>{formatUnits(action.amount,action.asset===ZeroAddress?18:6)} {action.asset===ZeroAddress?'ETH':'USDC'}</dd><dt>Recipient</dt><dd className="savings-address">{action.recipient}</dd></>}
       <dt>Vault</dt><dd className="savings-address">{expectation.vault}</dd><dt>Approval expires</dt><dd>{new Date(review.timing.expiry*1000).toISOString()}</dd>
       <dt>{review.timing.kind==='new-queue-delay'?'Wait after on-chain queue':'Timing'}</dt><dd>{review.timing.kind==='new-queue-delay'?`${review.timing.delaySeconds/60} minutes`:review.timing.kind==='immediate-protection'?'No waiting period; contract checks apply':'Reported ready time reached; queue evidence remains unverified'}</dd>
       {details?.newConfiguration&&<><dt>New protection</dt><dd>{details.newConfiguration.preset===0?'Standard · 1 signer':'Strong · 2 of 3'}</dd>{details.newConfiguration.signers.map((signer,i)=><div className="savings-fact-pair" key={signer}><dt>New signer {i+1}</dt><dd className="savings-address">{signer}</dd></div>)}</>}
      </dl><details className="savings-disclosure"><summary>All authorization details<ChevronDown size={15}/></summary><dl className="savings-details">{review.rows.filter(row=>row.label!=='This offline signer').map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></details>
     </div>
     {progress.requiredApprovals>0?<><div className="savings-activity-controls"><button type="button" className="savings-secondary" disabled={busy} onClick={()=>exportFile('request')}><Download size={15}/>Save action request</button><button type="button" className="savings-secondary" disabled={busy} onClick={()=>exportFile('identity')}><Download size={15}/>Save identity file</button></div>
      <p className="savings-muted">Take both files to each required offline signer. Check the vault and action on that device, approve, then import its signed approval. Requires unreleased offline support.</p>
      <div className="savings-approval-count" role="status"><strong>{progress.collectedApprovals} / {progress.requiredApprovals}</strong><span>valid signer approvals · not submitted</span></div>
      {progress.signers.map(signer=><p key={signer} className="savings-address">{signer}</p>)}
      <div className="savings-activity-controls"><label className={`savings-upload savings-secondary${busy?' is-disabled':''}`}><Upload size={15}/>Add approval or saved collection<input disabled={busy} aria-label="Import savings authorization or collection" type="file" accept=".json,application/json" onChange={e=>{void importApproval(e.target.files?.[0]);e.target.value='';}}/></label><button type="button" className="savings-back" disabled={busy||progress.collectedApprovals===0} onClick={()=>exportFile('approvals')}>Save collected approvals</button></div></>:
      <p className="savings-muted">Execution requires no new owner signature. The exact action must already be authorized and queued on-chain. The imported file does not establish that it is.</p>}
     <button type="button" className="savings-secondary" disabled={!progress.canAssemble||busy} onClick={()=>exportFile('call')}><Download size={15}/>Export unfunded test call</button>
     <p className="savings-muted">Anyone holding these approvals may submit the approved action. This export is not a transaction or receipt; verify any later result in savings activity.</p>
     {progress.canAssemble&&<SavingsTransaction key={JSON.stringify(collection)} expectation={expectation} request={request} collection={collection!} local={local} initialWallet={initialWallet} onObserved={observed} onExecution={execution}/>}
    </>}
   </section>}
   {message&&<p role="status" className="savings-message">{message}</p>}
  </div>
 </details>;
}
