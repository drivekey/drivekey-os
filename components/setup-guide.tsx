'use client';
import Link from 'next/link';
import {useState} from 'react';
import {ArrowDown,ArrowUpRight,Check} from 'lucide-react';
import {TerminalHeader,TerminalBar,TerminalFooter} from './terminal-chrome';
import {ReleaseDownload} from './release-download';
import R21Setup from './r21-setup';
import {WalletPageHeader} from './wallet-page-header';
import {setupSteps} from '@/core/setup-guide';


export default function SetupGuide(){
 const [done,setDone]=useState<string[]>([]),[upgrade,setUpgrade]=useState(false);
 return <div className="terminal-app"><TerminalHeader/><main id="main" className="setup-guide"><WalletPageHeader title="Setup & recovery" description="Set up your offline wallet or restore a backup."/>
 <div id="r21-start"><R21Setup/></div><details className="r21-legacy-guide"><summary>Older r20 setup · native Robinhood ETH</summary><fieldset className="setup-path"><legend>Choose your setup</legend><label><input type="radio" name="setup-path" checked={!upgrade} onChange={()=>setUpgrade(false)}/> New wallet</label><label><input type="radio" name="setup-path" checked={upgrade} onChange={()=>setUpgrade(true)}/> Upgrade an existing wallet</label>{upgrade&&<p role="note">Before flashing, verify a separate encrypted backup and preferably use another empty USB. Restore your existing wallet in step 5. Creating a new wallet does not move your funds.</p>}</fieldset>
 <div className="setup-guide-layout"><aside className="setup-index"><div className="setup-progress"><span>CHECKLIST</span><strong>{done.length} / 8</strong><p>Mark each step yourself. Progress resets on reload.</p></div><nav aria-label="Setup steps">{setupSteps.map((s,i)=><a key={s.id} href={`#${s.id}`}><span>{done.includes(s.id)?<Check size={14}/>:String(i+1).padStart(2,'0')}</span>{s.title}</a>)}</nav></aside><div className="setup-steps">{setupSteps.map((s,i)=><section className="setup-step" id={s.id} key={s.id}><TerminalBar name={`STEP ${String(i+1).padStart(2,'0')} / ${s.id}`} meta={i===4?'OFFLINE ONLY':undefined}/><div className="setup-step-body"><h2>{s.title}</h2><p className="setup-lead">{s.intro}</p>{'warning' in s&&<p className="setup-warning">{s.warning}</p>}<ol>{s.steps.map(line=><li key={line}>{line}</li>)}</ol>
 {s.id==='download'&&<div className="setup-download"><ReleaseDownload kind="image"/></div>}
 {s.id==='prepare'&&<p><a href="https://rufus.ie/" target="_blank" rel="noreferrer">Rufus official website ↗</a></p>}
 {s.id==='boot'&&<details><summary>I landed back in Windows. What now?</summary><p>Check that the ISO was written as an image, not copied onto the USB as a file. Use the one-time boot menu and select the intended USB. A disabled or unsupported boot entry needs manufacturer guidance—not repeated flashing of your vault drive.</p></details>}
 {(s.id==='return'||s.id==='transfer')&&<Link className="terminal-cta" href="/app/manual">Open Send <ArrowUpRight size={16}/></Link>}
 <label className="setup-check"><input type="checkbox" checked={done.includes(s.id)} onChange={e=>setDone(old=>e.target.checked?[...old,s.id]:old.filter(id=>id!==s.id))}/>{s.check}</label>{i<7?<a className="setup-next" href={`#${setupSteps[i+1].id}`}>Next: {setupSteps[i+1].title} <ArrowDown size={14}/></a>:<Link className="setup-next" href="#security">Read Security / FAQ <ArrowUpRight size={14}/></Link>}</div></section>)}</div></div>
 </details><section id="security" className="setup-closing"><h2>Know your setup’s limits</h2><p>Offline boot still relies on your PC and USB. It provides no secure element or verified boot and cannot guarantee protection from malware. USB files can be copied or changed. Keep a separate encrypted backup.</p></section></main><TerminalFooter/></div>;
}
