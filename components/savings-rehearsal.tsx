'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import {multiPublicSchema,type MultiPublic} from '@/core/multi-protocol';
import {parseStrictPublicJson} from '@/core/strict-public-json';
import {savingsSetupProgress,type SavingsSetup,type SetupProof} from '@/core/savings-setup';
import {savingsTransactionRequestSchema,type SavingsTransactionRequest} from '@/core/savings-transaction';
import type {SavingsReviewExpectation} from '@/core/savings-action-review';
import SavingsActions from './savings-actions';
import SavingsTransactionTransfer,{readSavingsPublicFile,saveSavingsPublicFile} from './savings-transaction-transfer';
import {savingsLocalCall,savingsLocalResultSchema,type SavingsLocalResult} from './savings-rehearsal-client';
type Props={setup:SavingsSetup|null;proofs:SetupProof[]};
export default function SavingsRehearsal({setup,proofs}:Props){
 const [available,setAvailable]=useState(false),[wallet,setWallet]=useState<MultiPublic|null>(null),[request,setRequest]=useState<SavingsTransactionRequest|null>(null),[candidate,setCandidate]=useState<SavingsReviewExpectation|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),inflight=useRef(false);
 useEffect(()=>{const control=new AbortController();void fetch('/api/savings/rehearsal',{cache:'no-store',signal:control.signal}).then(async r=>{if(r.ok&&!control.signal.aborted)setAvailable(savingsLocalResultSchema.parse(await r.json()).available===true);}).catch(()=>{});return()=>{control.abort();generation.current++;};},[]);
 let ready=false;try{ready=!!setup&&savingsSetupProgress(setup,proofs).ceremonyVerified;}catch{/* Expired setup cannot prepare deployment. */}
 async function load(file?:File){if(!file)return;const id=++generation.current;setWallet(null);setRequest(null);setCandidate(null);setMessage('');setBusy(true);
  try{const raw=await readSavingsPublicFile(file);if(id===generation.current)setWallet(multiPublicSchema.parse(parseStrictPublicJson(raw,32768)));}
  catch(e){if(id===generation.current)setMessage(e instanceof Error?e.message:'Public wallet rejected.');}finally{if(id===generation.current)setBusy(false);}
 }
 async function prepare(){if(!setup||!ready||!wallet||inflight.current)return;inflight.current=true;const id=++generation.current;setBusy(true);setRequest(null);setCandidate(null);setMessage('');
  try{const r=await savingsLocalCall('prepare-deployment',{setup,proofs,wallet});if(id===generation.current)setRequest(savingsTransactionRequestSchema.parse(r.request));}
  catch(e){if(id===generation.current)setMessage(e instanceof Error?e.message:'Local deployment could not be prepared.');}finally{if(id===generation.current){inflight.current=false;setBusy(false);}}
 }
 function observed(result:SavingsLocalResult){if(result.status==='local-vault-created'&&result.identity)setCandidate(result.identity);}
 return <>
  {available&&<section className="savings-panel" aria-label="Local savings rehearsal" aria-busy={busy}>
   <div className="savings-section-heading"><h2>Try the complete savings flow</h2><span className="savings-stage">Local rehearsal · synthetic funds only</span></div>
   <p className="savings-muted">Deploy the pinned candidate on your local test chain, then rehearse approvals, waiting and execution. Live deposits stay disabled.</p>
   {!ready?<p>Finish the signer and backup checks above to prepare a local vault.</p>:<>
    <label className="savings-upload savings-secondary"><Upload size={15}/>Load rehearsal gas wallet<input aria-label="Local savings gas wallet" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
    {wallet&&<p className="savings-address">Separate gas wallet: {wallet.evmAddress}</p>}
    {!request&&<button type="button" className="savings-secondary" disabled={busy||!wallet} onClick={()=>void prepare()}>Prepare local vault deployment</button>}
    {request&&<SavingsTransactionTransfer key={request.fingerprint} request={request} local onObserved={observed}/>}
   </>}
   {candidate&&<div className="savings-activity-card"><strong>Local vault created · enrollment pending</strong><p className="savings-address">{candidate.vault}</p><p className="savings-muted">The local code and policy match. This does not establish an independently trusted signer identity, clock or rollback protection.</p><button type="button" className="savings-secondary" onClick={()=>saveSavingsPublicFile(candidate,'savings-review-expectation.json')}>Save candidate identity</button></div>}
   {message&&<p className="savings-message" role="status">{message}</p>}
  </section>}
  <SavingsActions key={candidate?.vault??'manual'} initialExpectation={candidate??undefined} local={!!candidate&&available} initialWallet={wallet??undefined}/>
 </>;
}
