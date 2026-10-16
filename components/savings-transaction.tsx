'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import {multiPublicSchema,type MultiPublic} from '@/core/multi-protocol';
import {parseStrictPublicJson} from '@/core/strict-public-json';
import {prepareSavingsRelayTransaction,savingsTransactionRequestSchema,type SavingsTransactionRequest} from '@/core/savings-transaction';
import type {SavingsReviewExpectation,SavingsActionReviewRequest} from '@/core/savings-action-review';
import type {SavingsApprovalCollection} from '@/core/savings-action-workflow';
import SavingsTransactionTransfer,{readSavingsPublicFile} from './savings-transaction-transfer';
import {savingsLocalCall,type SavingsLocalResult} from './savings-rehearsal-client';
type Props={expectation:SavingsReviewExpectation;request:SavingsActionReviewRequest;collection:SavingsApprovalCollection;local?:boolean;initialWallet?:MultiPublic;onObserved?:(result:SavingsLocalResult)=>void;onExecution?:(result:SavingsLocalResult)=>void};
/** Generic calldata is never accepted. Both paths rebuild the reviewed owner operation. */
export default function SavingsTransaction({expectation,request,collection,local=false,initialWallet,onObserved,onExecution}:Props){
 const [wallet,setWallet]=useState<MultiPublic|null>(initialWallet??null),[gas,setGas]=useState({nonce:'',gasLimit:'',maxFeePerGas:'',maxPriorityFeePerGas:''});
 const [prepared,setPrepared]=useState<SavingsTransactionRequest|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),inflight=useRef(false);useEffect(()=>()=>{generation.current++;},[]);
 function clear(){generation.current++;inflight.current=false;setPrepared(null);setMessage('');setBusy(false);}
 async function openWallet(file?:File){if(!file)return;clear();setWallet(null);const id=++generation.current;setBusy(true);
  try{const raw=await readSavingsPublicFile(file);if(id===generation.current)setWallet(multiPublicSchema.parse(parseStrictPublicJson(raw,32768)));}
  catch(e){if(id===generation.current)setMessage(e instanceof Error?e.message:'Public wallet rejected.');}finally{if(id===generation.current)setBusy(false);}
 }
 async function prepare(){if(inflight.current)return;clear();inflight.current=true;const id=++generation.current;setBusy(true);try{
  if(!wallet)throw Error('Load your separate everyday public wallet.');
  if(local){const result=await savingsLocalCall('prepare-relay',{expectation,request,collection,wallet});if(id===generation.current)setPrepared(savingsTransactionRequestSchema.parse(result.request));}
  else {if(!/^(0|[1-9][0-9]*)$/.test(gas.nonce))throw Error('Enter the exact gas-wallet nonce.');const now=Date.now();
   setPrepared(prepareSavingsRelayTransaction(expectation,request,collection,wallet.evmAddress,{...gas,nonce:Number(gas.nonce)},{requestId:crypto.randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+7200000).toISOString()},now));}
 }catch(e){if(id===generation.current)setMessage(e instanceof Error?e.message:'Gas transaction could not be prepared.');}finally{if(id===generation.current){inflight.current=false;setBusy(false);}}}
 return <section className="savings-action-section" aria-label="Offline gas approval" aria-busy={busy}>
  <h3>Approve the network fee offline</h3><p className="savings-muted">Your separate everyday wallet pays gas. {local?'Synthetic local rehearsal only.':'Prepare public files only; live submission remains unavailable.'}</p>
  <label className="savings-upload savings-secondary"><Upload size={15}/>Load everyday public wallet<input disabled={busy} aria-label="Savings gas public wallet" type="file" accept=".json,application/json" onChange={e=>{void openWallet(e.target.files?.[0]);e.target.value='';}}/></label>
  {wallet&&<p className="savings-address">Gas wallet: {wallet.evmAddress}</p>}
  {!local&&<fieldset disabled={busy||!!prepared} className="savings-fields">{([['nonce','Gas-wallet nonce'],['gasLimit','Gas limit'],['maxFeePerGas','Maximum fee per gas · wei'],['maxPriorityFeePerGas','Priority fee per gas · wei']] as const).map(([key,label])=><label key={key}>{label}<input inputMode="numeric" maxLength={78} value={gas[key]} onChange={e=>{clear();setGas(v=>({...v,[key]:e.target.value}));}}/></label>)}</fieldset>}
  {!prepared?<button type="button" className="savings-secondary" disabled={busy||!wallet} onClick={()=>void prepare()}>Prepare gas approval</button>:<button type="button" className="savings-back" onClick={clear}>Start a fresh gas review</button>}
  {prepared&&<SavingsTransactionTransfer key={prepared.fingerprint} request={prepared} local={local} onObserved={onObserved} onExecution={onExecution}/>}
  {message&&<p role="status" className="savings-message">{message}</p>}
 </section>;
}
