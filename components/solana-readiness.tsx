'use client';
import {useEffect,useRef,useState} from 'react';
import type {MultiPublic} from '@/core/multi-protocol';
import {noncePublicKey} from '@/core/nonce-setup-protocol';
import {NonceSetup} from './nonce-setup';
import {OfflineNonceSetup} from './offline-nonce-setup';

export type SolanaSelection={walletId:string;address:string};
export const solanaWalletId=(wallet:MultiPublic)=>wallet.deviceId+':'+wallet.solanaAddress;

// An address saved in this browser is only a hint. Always verify it on chain.
export function SolanaReadiness({wallet,onReady,disabled=false,onBusy}:{wallet:MultiPublic;onReady:(selection:SolanaSelection)=>void;disabled?:boolean;onBusy?:(busy:boolean)=>void}){
 const [state,setState]=useState<'checking'|'ready'|'missing'|'error'>('checking');
 const [funding,setFunding]=useState<'sponsor'|'offline'|null>(null);
 const [address,setAddress]=useState(''),[manual,setManual]=useState(''),[message,setMessage]=useState(''),[setup,setSetup]=useState(false);
 const callback=useRef(onReady);callback.current=onReady;
 const revision=useRef(0),mounted=useRef(false);
 const walletId=solanaWalletId(wallet),key='drivekey.solana-setup.v1:'+walletId;
 function accept(address:string){
  noncePublicKey.parse(address);
  setAddress(address);setManual(address);setState('ready');setSetup(false);setMessage('');
  try{localStorage.setItem(key,address);}catch{/* On-chain readiness does not depend on optional address storage. */}
  callback.current({walletId,address});
 }
 async function check(candidate?:string){
  const current=++revision.current;
  setState('checking');setMessage('');callback.current({walletId,address:''});
  try{
   if(candidate)noncePublicKey.parse(candidate);
   const response=await fetch('/api/nonce-offline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',wallet,...(candidate?{address:candidate}:{})}),signal:AbortSignal.timeout(25000)});
   const value=await response.json();
   if(!mounted.current||current!==revision.current)return;
   if(!response.ok||value.error)throw Error(value.error||'Solana setup could not be checked.');
   if(value.state==='ready'&&value.authority===wallet.solanaAddress&&(!candidate||value.address===candidate))accept(value.address);
   else if(value.state==='missing'){setAddress('');setState('missing');}
   else throw Error('Solana returned an unexpected setup result. Please check again.');
  }catch(e){if(mounted.current&&current===revision.current){setState('error');setMessage(e instanceof Error?e.message:'Solana is unavailable. Try checking again.');}}
 }
 useEffect(()=>{
  mounted.current=true;
  let saved:string|undefined;
  try{const value=localStorage.getItem(key);if(value&&noncePublicKey.safeParse(value).success)saved=value;}catch{/* Check the wallet's default account instead. */}
  void check(saved);
  return()=>{mounted.current=false;revision.current++;};
 // Parents key this component by the complete public-wallet identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);
 return <section className="solana-readiness" aria-label="Solana setup">
  <h3>{state==='ready'?'Solana is ready':state==='checking'?'Checking Solana setup…':'Set up Solana once'}</h3>
  {state==='ready'?<p>Your offline signing account is verified. Continue with your transaction.</p>:state==='checking'?<p>Checking this wallet on Solana. No transaction is being created.</p>:state==='missing'?<><p>This wallet needs a small network deposit before its first offline Solana payment or swap. Once confirmed, DriveKey reuses the setup.</p>{!setup&&<button type="button" disabled={disabled} onClick={()=>setSetup(true)}>Set up Solana</button>}</>:<p role="alert">{message}</p>}
  <details><summary>Advanced · existing account and technical details</summary>
   <p>Solana calls this a durable nonce account. It lets the prepared transaction survive the time spent signing offline. Quotes and app approvals still have their own deadlines.</p>
   {address&&<p>Verified account: <code className="dk-full-address">{address}</code></p>}
   <label>Existing nonce account<input value={manual} disabled={disabled||state==='checking'} spellCheck={false} onChange={e=>setManual(e.target.value)}/></label>
   <button type="button" disabled={disabled||state==='checking'||!manual.trim()} onClick={()=>void check(manual.trim())}>Check existing account</button>
   <button type="button" disabled={disabled||state==='checking'} onClick={()=>void check()}>Check default account</button>
  </details>
  {state==='error'&&<button type="button" disabled={disabled} onClick={()=>void check()}>Retry Solana check</button>}
  {setup&&state==='missing'&&!funding&&<div><p>Choose where the setup deposit and fee come from. Both methods keep your offline wallet as the nonce authority.</p><button type="button" disabled={disabled} onClick={()=>setFunding('sponsor')}>Use a separate funding wallet</button><button type="button" disabled={disabled} onClick={()=>setFunding('offline')}>Use offline wallet balance for setup</button><p>The offline option requires SOL already in your offline wallet and a signer/file-transfer workflow ready for the short approval window. Submission remains subject to this build's release checks.</p></div>}
  {setup&&state==='missing'&&funding==='offline'&&<OfflineNonceSetup key={walletId} wallet={wallet} disabled={disabled} onBusy={value=>onBusy?.(value)} onReady={value=>{if(mounted.current)void check(value);}}/>}
  {setup&&state==='missing'&&funding==='sponsor'&&<NonceSetup key={walletId} wallet={wallet} disabled={disabled} onBusy={value=>onBusy?.(value)} onReady={value=>{if(mounted.current)accept(value);}}/>}
 </section>;
}
