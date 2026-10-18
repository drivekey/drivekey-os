'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {ArrowLeft, ArrowRight, Check, LockKeyhole, Download, Upload, CheckCircle2, Clock3, ChevronDown} from 'lucide-react';
import {ZodError} from 'zod';
import {TerminalHeader, TerminalFooter} from './terminal-chrome';
import {WalletPageHeader} from './wallet-page-header';
import {validateSavingsSetup, savingsSetupProgress, verifySetupProof, setupFingerprint, type SavingsSetup, type SetupProof} from '@/core/savings-setup';
import {parseStrictPublicJson} from '@/core/strict-public-json';
import SavingsActivity from './savings-activity';
import SavingsRehearsal from './savings-rehearsal';

function download(value: unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='savings-setup-request.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function publicFile(file: File) {
  if(!file.name.toLowerCase().endsWith('.json')||file.size>65536)throw Error('Choose a public JSON file up to 64 KB.');
  return parseStrictPublicJson(await file.text());
}
export default function SavingsWorkspace(){
  const [step,setStep]=useState<1|2|3>(1);
  const [preset,setPreset]=useState<'standard'|'strong'>('strong');
  const [spending,setSpending]=useState(''),[signers,setSigners]=useState(['','','']);
  const [independent,setIndependent]=useState(false),[locations,setLocations]=useState(false);
  const [setup,setSetup]=useState<SavingsSetup|null>(null),[proofs,setProofs]=useState<SetupProof[]>([]),[message,setMessage]=useState('');
  const [now,setNow]=useState(0);
  const generation=useRef(0);
  const stepHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{stepHeading.current?.focus({preventScroll:true});},[step]);
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const expired=!!setup&&now>=Date.parse(setup.expiresAt);
  const progress=useMemo(()=>{if(!setup||expired)return null;try{return savingsSetupProgress(setup,proofs);}catch{return null;}},[setup,proofs,expired]);
  function reset(){generation.current++;setSetup(null);setProofs([]);setMessage('');}
  function prepare(){reset();try{
    if(!independent||!locations)throw Error('Confirm your separate keys and saved backups to continue.');
    const created=Date.now(),bytes=crypto.getRandomValues(new Uint8Array(32));
    const next=validateSavingsSetup({kind:'drivekey-savings-setup',version:1,chainId:1,sessionId:crypto.randomUUID(),createdAt:new Date(created).toISOString(),expiresAt:new Date(created+86400000).toISOString(),challenge:'0x'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),preset,spendingAccount:spending.trim(),signers:signers.slice(0,preset==='strong'?3:1).map(s=>s.trim())});
    setNow(created);setSetup(next);setProofs([]);setStep(3);setMessage('Setup file ready. No funds moved.');
  }catch(error){
    if(error instanceof ZodError){const issue=error.issues[0];setMessage(issue.path[0]==='spendingAccount'?'Enter a valid Ethereum address for your everyday wallet.':issue.path[0]==='signers'?`Enter a valid Ethereum address for signer ${Number(issue.path[1]??0)+1}.`:issue.message);}
    else setMessage(error instanceof Error?error.message:'Setup could not be prepared.');
  }}
  async function importProof(file?:File){if(!file||!setup)return;const operation=generation.current;try{
    const proof=verifySetupProof(await publicFile(file),setup);
    if(operation!==generation.current)return;
    setProofs(old=>[...old.filter(p=>p.signer!==proof.signer||p.purpose!==proof.purpose),proof]);
    setMessage('Proof verified for this signer and setup.');
  }catch(error){if(operation===generation.current)setMessage(error instanceof Error?error.message:'Proof could not be verified.');}}
  async function restore(file?:File){if(!file)return;reset();setStep(2);const operation=generation.current;try{
    const next=validateSavingsSetup(await publicFile(file));if(operation!==generation.current)return;setNow(Date.now());setSetup(next);setPreset(next.preset);setSpending(next.spendingAccount);setSigners([...next.signers,...Array(3-next.signers.length).fill('')]);setIndependent(false);setLocations(false);setStep(3);
    setMessage('Setup opened. Add your signed proofs again so we can recheck them.');
  }catch(error){if(operation===generation.current)setMessage(error instanceof Error?error.message:'Setup could not be restored.');}}
  const title=preset==='strong'?'Strong':'Standard';
  function choose(value:'standard'|'strong'){reset();setPreset(value);setIndependent(false);setLocations(false);}
  return <div className="terminal-app savings-app"><TerminalHeader/><main id="main"><div id="dvk-savings" data-preset={preset}>
    <WalletPageHeader title="Savings" description="Keep savings separate from everyday spending." icon={<LockKeyhole size={20}/>} actions={<span className="savings-stage">Unfunded preview · no deposits</span>}/>
    <nav className="savings-steps" aria-label="Savings setup steps">
      {(['Choose protection','Add signers','Verify offline'] as const).map((label,index)=><button key={label} disabled={index===2&&!setup} aria-current={step===index+1?'step':undefined} onClick={()=>{setStep((index+1) as 1|2|3);setMessage('');}}><span>{step>index+1?<Check size={13}/>:index+1}</span>{label}</button>)}
    </nav>
    {step===1&&<section aria-labelledby="savings-step-title" className="savings-choice">
      <div className="savings-section-heading"><h2 id="savings-step-title" ref={stepHeading} tabIndex={-1}>Choose your protection</h2><span>ETH & USDC · Ethereum</span></div>
      <div className="savings-presets" role="group" aria-label="Savings protection preset">
        {(['standard','strong'] as const).map(value=><button key={value} className={`savings-preset ${value}`} aria-label={`${value==='strong'?'Strong':'Standard'} protection`} aria-pressed={preset===value} onClick={()=>choose(value)}>
          <span className="savings-card-top"><span>{value==='strong'?'Independent keys':'Single key'}</span><span className="savings-radio">{preset===value&&<Check size={13}/>}</span></span>
          <span className={`savings-art ${value}`} aria-hidden="true"><Image src="/brand/savings/dvk-presets-minimal.png" alt="" width={2688} height={1520} sizes="400px" priority/></span>
          <strong className="savings-preset-name">{value==='strong'?'Strong':'Standard'}</strong>
          <span className="savings-metrics"><span><b>{value==='strong'?'2 of 3':'1 signer'}</b><small>{value==='strong'?'signers approve':'approves'}</small></span><span><b>{value==='strong'?'15 min':'5 min'}</b><small>withdrawal wait</small></span></span>
        </button>)}
      </div>
      <div className="savings-shared"><span><LockKeyhole size={14}/> Offline approvals</span><span><Clock3 size={14}/> Security changes wait 1 hour</span></div>
      <div className="savings-actions"><button className="savings-primary" onClick={()=>{setStep(2);setMessage('');}}>Continue with {title}<ArrowRight size={16}/></button></div>
    </section>}
    {step===2&&<section className="savings-panel" aria-labelledby="savings-step-title">
      <div className="savings-section-heading"><h2 id="savings-step-title" ref={stepHeading} tabIndex={-1}>Add your {preset==='strong'?'three signers':'signer'}</h2><span className="savings-selected">{title}</span></div>
      <p className="savings-muted">Enter the public Ethereum address of each offline signer.</p>
      <div className="savings-fields"><label>Everyday wallet<input aria-label="Everyday spending address" autoComplete="off" spellCheck={false} value={spending} onChange={e=>{reset();setSpending(e.target.value);}} placeholder="0x…"/></label>
      <div className="savings-signer-fields">{signers.slice(0,preset==='strong'?3:1).map((address,index)=><label key={index}>Signer {index+1}<input aria-label={`Savings signer ${index+1}`} autoComplete="off" spellCheck={false} value={address} onChange={e=>{reset();setSigners(old=>old.map((v,i)=>i===index?e.target.value:v));}} placeholder="0x…"/></label>)}</div></div>
      <aside className="savings-recovery"><LockKeyhole size={17}/><div><strong>Recovery</strong><p>{preset==='strong'?'Two keys can replace a lost key after 1 hour. Losing two keys and their backups may permanently lock your savings.':'Losing your only key and its backup may permanently lock your savings.'} DriveKey cannot reset your keys.</p></div></aside>
      <label className="savings-check"><input type="checkbox" checked={independent} onChange={e=>{reset();setIndependent(e.target.checked);}}/>Each savings key was created separately from my other keys.</label>
      <label className="savings-check"><input type="checkbox" checked={locations} onChange={e=>{reset();setLocations(e.target.checked);}}/>I saved encrypted backups separately and understand the recovery limits.</label>
      <div className="savings-actions"><button className="savings-back" onClick={()=>{setStep(1);setMessage('');}}><ArrowLeft size={15}/>Back</button><button className="savings-primary" onClick={prepare}>Create setup file<ArrowRight size={16}/></button></div>
    </section>}
    {step===3&&setup&&<section className="savings-panel" aria-labelledby="savings-step-title">
      <div className="savings-section-heading"><h2 id="savings-step-title" ref={stepHeading} tabIndex={-1}>Verify your signers</h2><span className="savings-selected">{title}</span></div>
      <div className="savings-transfer"><div><span className="savings-task-number">01</span><h3>Save the setup</h3><p>Move this public file to your offline signer.</p><button className="savings-secondary" disabled={expired} onClick={()=>{try{download(validateSavingsSetup(setup));}catch(error){setMessage(error instanceof Error?error.message:'Export unavailable.');}}}><Download size={16}/>Save setup file</button></div><div><span className="savings-task-number">02</span><h3>Approve offline</h3><p>Review each key, test its backup, then approve the shared rehearsal.</p><small>Preview: the matching offline update is not released yet.</small></div><div><span className="savings-task-number">03</span><h3>Add signed proofs</h3><p>Bring back one public proof at a time.</p><label className={`savings-upload savings-secondary${expired?' is-disabled':''}`}><Upload size={16}/>Add signed proof<input aria-label="Import one signer proof" disabled={expired} type="file" accept=".json,application/json" onChange={e=>{void importProof(e.target.files?.[0]);e.target.value='';}}/></label></div></div>
      {expired?<p className="savings-message" role="alert">This setup expired. Create a new file; old proofs cannot be reused.</p>:<div className="savings-progress">{[['Keys checked',progress?.registered,progress?.requiredSigners],['Backups checked',progress?.restored,progress?.requiredSigners],['Shared approvals',progress?.quorum,progress?.requiredQuorum]].map(([label,count,total])=><div key={label} data-complete={count===total}><span>{label}</span><strong>{count} <small>/ {total}</small></strong></div>)}</div>}
      {progress?.ceremonyVerified&&<div className="savings-verified"><CheckCircle2 size={20}/><div><strong>All setup proofs verified.</strong><p>Key control confirmed. Funding stays unavailable until release checks pass.</p></div></div>}
      <details className="savings-disclosure"><summary>Setup details<ChevronDown size={15}/></summary><dl className="savings-details"><dt>Setup fingerprint</dt><dd>{setupFingerprint(setup)}</dd><dt>Expires</dt><dd>{setup.expiresAt}</dd></dl><p>Proofs confirm key control, not independent devices or hardware integrity. They cannot approve payments.</p></details>
      <button className="savings-back" onClick={()=>setStep(2)}><ArrowLeft size={15}/>Edit signer addresses</button>
    </section>}
    {message&&<p className="savings-message" role="status">{message}</p>}
    <div className="savings-bottom"><label className="savings-upload savings-resume"><Upload size={14}/>Open an existing setup<input aria-label="Restore public setup" type="file" accept=".json,application/json" onChange={e=>{void restore(e.target.files?.[0]);e.target.value='';}}/></label><Link href="/app/swap">Everyday wallet<ArrowRight size={14}/></Link></div>
    <details className="savings-disclosure savings-about"><summary>How protection works<ChevronDown size={15}/></summary><p>Once approved on-chain, withdrawals wait 5 minutes in Standard or 15 minutes in Strong. This gives you a short time to cancel. One signer can pause the vault or cancel a withdrawal. In Strong, changing signers or cancelling a signer change needs two approvals. Signer changes and resuming wait 1 hour.</p><p>Savings holds ETH and Ethereum USDC only. Swaps and agents stay in your everyday wallet. Nothing refills or migrates automatically. Losing the required keys and backups can permanently lock access; DriveKey has no recovery key.</p><p>This is an unfunded development preview. A matching offline build, trusted enrollment, independent contract review and hardware validation remain required before funding. Post-quantum protection is separate research, not a feature of this vault.</p></details>
    <SavingsRehearsal key={setup?setupFingerprint(setup)+JSON.stringify(proofs):'no-setup'} setup={setup} proofs={proofs}/>
    <SavingsActivity/>
  </div></main><TerminalFooter/></div>;
}
