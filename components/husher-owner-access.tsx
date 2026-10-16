'use client';
import {useEffect,useRef,useState} from 'react';

export function HusherOwnerAccess({onSignIn,onCheckSession}:{onSignIn:(code:string)=>Promise<void>;onCheckSession:()=>Promise<void>}){
 const [code,setCode]=useState(''),[pending,setPending]=useState<'login'|'check'|null>(null),[error,setError]=useState('');
 const running=useRef(false);
 const feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error)feedback.current?.scrollIntoView({block:'nearest'});},[error]);
 async function run(action:'login'|'check'){
  if(running.current)return;
  const value=code.trim();if(action==='login'&&!value)return;
  running.current=true;setPending(action);setError('');
  if(action==='login')setCode('');
  try{if(action==='login')await onSignIn(value);else await onCheckSession();}
  catch(e){setError(e instanceof Error?e.message:'Owner access could not be checked.');}
  finally{running.current=false;setPending(null);}
 }
 return <section className="payments-card" aria-label="Owner access" aria-busy={!!pending}>
  <h2>Owner access</h2>
  <p>Use your DriveKey owner code. Never enter a wallet passphrase, seed phrase or API key.</p>
  <form onSubmit={e=>{e.preventDefault();void run('login');}}>
   <label>Owner access code<input type="password" value={code} autoComplete="off" disabled={!!pending} onChange={e=>setCode(e.target.value)} aria-describedby="husher-owner-feedback"/></label>
   <p ref={feedback} id="husher-owner-feedback" role={error?'alert':'status'} aria-live="polite">{error||(pending==='login'?'Signing in…':pending==='check'?'Checking your owner session…':'')}</p>
   <button type="submit" disabled={!!pending||!code.trim()}>{pending==='login'?'Signing in…':'Sign in'}</button>
   <button type="button" disabled={!!pending} onClick={()=>void run('check')}>{pending==='check'?'Checking session…':'Check owner session'}</button>
  </form>
 </section>;
}
