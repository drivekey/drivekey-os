"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowUpRight, Check, FileCheck2, Fingerprint, HardDrive, KeyRound, Monitor, Power, RotateCcw, ShieldCheck, Usb } from "lucide-react";
import { Button } from "./ui";
import { ReleaseDownload } from "./release-download";
import { EthCharacters, TerminalBar, TerminalFooter, TerminalHeader } from "./terminal-chrome";


const bootLines=['[ OK ] Loading Linux live environment','[ OK ] Starting local signing interface','[ OK ] Ready for an offline session','drivekey@live:~$ ./start'];

function BootTerminal({wordmark}:{wordmark:string}) {
  const [run,setRun]=useState(0),[skip,setSkip]=useState(false);
  const [reduce,setReduce]=useState(true);
  useEffect(()=>{const mq=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduce(mq.matches);update();mq.addEventListener('change',update);return()=>mq.removeEventListener('change',update);},[]);
  return <section className={`boot-terminal ${skip||reduce?'boot-static':'boot-animate'}`} aria-label="Illustrated Linux boot sequence">
    <TerminalBar name="drivekey / live session" meta="BOOT DEMO"/>
    <div className="boot-screen" key={`${run}-${reduce}`}>
      <div className="boot-log" aria-hidden="true">{bootLines.map((line,i)=><div key={line} style={{animationDelay:`${.3+i*.32}s`}}>{line}</div>)}</div>
      <pre className="boot-wordmark" role="img" aria-label="DriveKey character wordmark">{wordmark.split('\n').filter(Boolean).map((line,i)=><span key={i} style={{animationDelay:`${1.45+i*.02}s`}}>{line||' '}{'\n'}</span>)}</pre>
      <div className="boot-prompt"><span aria-hidden="true">&gt;</span><span>Your key stays on the offline side.</span><span className="terminal-cursor" aria-hidden="true">█</span></div>
    </div>
    <div className="boot-bottom"><span>Illustration · this website is not running Linux</span><div><button type="button" onClick={()=>setSkip(true)}>Skip animation</button><button type="button" aria-label="Replay boot animation" onClick={()=>{setSkip(false);setRun(v=>v+1);}}><RotateCcw size={13}/> Replay</button></div></div>
  </section>;
}

const features=[
  {icon:KeyRound,id:'01',title:'A vault you create offline.',text:'Generate your wallet in the USB’s Linux environment. Encrypt it with a passphrase that stays out of the website.',command:'vault.create → encrypted file'},
  {icon:FileCheck2,id:'02',title:'One request. Exact details.',text:'Recipient, amount, network and fee ceiling travel together. Review the same transaction again on the offline screen.',command:'request.freeze → review locally'},
  {icon:Fingerprint,id:'03',title:'Check the signature. Then send.',text:'Back online, the dashboard verifies the response against your saved request. Sending needs its own confirmation.',command:'signature.verify → explicit submit'},
  {icon:HardDrive,id:'04',title:'Files, not a closed ecosystem.',text:'Use a compatible USB and keep a separate encrypted backup. Export public metadata without exposing the private key.',command:'public.export → backup.verify'},
];

export default function TerminalLanding({wordmark}:{wordmark:string}) {
  const surface=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!surface.current)return;
    const sections=surface.current.querySelectorAll('.terminal-section');
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-revealed');observer.unobserve(e.target);}}),{threshold:.07});
    sections.forEach(section=>{section.classList.add('scroll-ready');observer.observe(section);});
    return()=>{observer.disconnect();sections.forEach(section=>section.classList.remove('scroll-ready'));};
  },[]);
  return <div className="terminal-app"><TerminalHeader/><main className="terminal-home" ref={surface}>
    <section className="system-intro"><div className="terminal-eyebrow"><span>DRIVEKEY / SYSTEM 01</span><span>ROBINHOOD CHAIN / NATIVE ETH</span></div><div className="intro-heading"><h1>Online to prepare.<br/><span>Offline to sign.</span></h1><div><p>A deliberate break between the internet and your private key. One computer. A bootable USB. Your approval.</p><Link href="/app/manual" className="terminal-cta">Open transfer terminal <ArrowUpRight size={18}/></Link></div></div></section>
    <BootTerminal wordmark={wordmark}/>
    <div className="system-strip"><span><span className="tiny-square"/> ETH TRANSFERS</span><span>LOCAL KEY CREATION</span><span>EXACT SIGNATURE VERIFICATION</span><a href="#mechanism">Explore the system <ArrowDown size={14}/></a></div>

    <section className="mechanism-section terminal-section" id="mechanism"><div className="section-index">01 / THE MECHANISM</div><div className="section-heading"><h2>A small file crosses.<br/>Your private key doesn’t.</h2><p>There is a real reboot between preparation and approval. Each side has a specific job.</p></div><div className="mechanism-track">
      <div><Monitor size={26}/><span>WINDOWS / ONLINE</span><h3>Prepare</h3><p>Set the recipient and amount. Save the unsigned request to USB.</p><code>unsigned-request.json</code></div>
      <div className="offline-node"><Usb size={26}/><span>USB LINUX / OFFLINE</span><h3>Review & sign</h3><p>Boot from USB. Verify every detail, unlock locally, then shut down.</p><code>signed-response.json</code></div>
      <div><FileCheck2 size={26}/><span>WINDOWS / ONLINE</span><h3>Verify & submit</h3><p>Import the response. Check it against the original request and explicitly send.</p><code>transaction receipt</code></div>
    </div></section>

    <section className="terminal-section" id="capabilities"><div className="section-index">02 / CAPABILITIES</div><div className="section-heading"><h2>Fewer moving parts.<br/>More deliberate control.</h2><EthCharacters/></div><div className="capability-grid">{features.map(({icon:Icon,...f})=><article key={f.id}><div className="capability-top"><Icon size={22}/><span>[{f.id}]</span></div><h3>{f.title}</h3><p>{f.text}</p><code><span>&gt;</span> {f.command}</code></article>)}</div></section>

    <section className="terminal-section security-section" id="security"><div className="section-index">03 / SECURITY MODEL</div><div className="section-heading"><h2>Know what<br/>you’re trusting.</h2><p>Separation is a workflow, not a guarantee. Here are the protections—and their boundaries.</p></div><div className="security-layout"><div className="security-console"><TerminalBar name="security / checks"/><div>{['Private key excluded from web requests','Full transaction review before approval','Signed response matched to frozen request','Current nonce, balance and fee preflight','No automatic retry after an uncertain send'].map(x=><p key={x}><Check size={15}/>{x}</p>)}</div></div><div className="security-details">
      <details open><summary>What does offline boot protect?</summary><p>It separates signing from the running Windows session. Use a trusted PC and disconnect networking before boot.</p></details>
      <details><summary>What does a USB not protect?</summary><p>A normal USB has no secure element and its files can be copied or modified. DriveKey does not guarantee clean firmware or boot media. A VM is for functional tests, not isolation from a compromised host.</p></details>
      <details><summary>What happens if I lose the USB?</summary><p>Recovery needs a separate encrypted backup and its passphrase. Test that backup offline. Reconnecting cannot recover a lost passphrase. Never reflash the only copy of a vault.</p></details>
      <details><summary>What does a signed file authorize?</summary><p>Anyone holding it can broadcast that exact transaction. The application’s deadline does not revoke a signature on-chain. Check uncertain results before preparing another payment.</p></details>
    </div></div></section>

    <section className="terminal-section release-gallery" id="desktop-r20"><div className="section-index">04 / DESKTOP R20</div><div className="section-heading"><h2>Your offline desktop.<br/>A clearer view.</h2><p>The DriveKey logo and character background, with dedicated spaces for vaults, transaction review and system controls. Actual screenshots from an unfunded VM demonstration.</p></div><div className="release-gallery-grid">{[
      {file:'01-home.png',title:'Home',description:'Your offline session at a glance.'},
      {file:'03-transaction-review.png',title:'Review & sign',description:'Read the exact transaction before approving.'},
      {file:'05-system.png',title:'System',description:'Clock, appearance and offline session controls.'},
    ].map(photo=><figure key={photo.file}><a href={`/releases/r20/${photo.file}`} target="_blank" rel="noreferrer" aria-label={`Open full ${photo.title} screenshot`}><Image src={`/releases/r20/${photo.file}`} alt={`DriveKey Desktop r20 — ${photo.title}`} width={1280} height={800} unoptimized/></a><figcaption><strong>{photo.title}</strong><span>{photo.description}</span></figcaption></figure>)}</div><a className="terminal-cta" href="/releases/r20/DriveKey-r20-demo-photos.zip" download>Download release screenshots <ArrowDown size={16}/></a><p className="dk-small">Husher integration is in preparation and remains disabled pending Partner Access.</p></section>

    <section className="terminal-section setup-section" id="setup"><div className="section-index">05 / GET SET UP</div><div className="section-heading"><h2>Bring a USB.<br/>Keep your keys.</h2><p>Already created your vault? Go straight to <Link href="/app/manual">Offline transfer</Link> and load its public file.</p></div><div className="setup-grid"><article><Power size={24}/><h3>01 / Offline system</h3><p>The bootable image bundles Linux, the graphical offline wallet, and its dependencies. No signing-time downloads.</p><ReleaseDownload kind="image"/><p className="setup-caution">Writing the image erases the selected drive. Never overwrite your only vault.</p></article><article><ShieldCheck size={24}/><h3>02 / Follow the walkthrough</h3><p>Create and verify your vault offline. Keep a separate encrypted backup before using real funds.</p><Button asChild variant="secondary"><a href="/app/setup">Step-by-step Setup <ArrowUpRight size={15}/></a></Button><p><Link href="/app/setup">Create a vault, verify your backup and learn your first transfer →</Link></p></article></div></section>
    <section className="terminal-final-cta"><span>READY WHEN YOU ARE.</span><Link href="/app/manual">Open transfer terminal <ArrowUpRight size={28}/></Link><code>drivekey@web:~$ prepare_</code></section>
  </main><TerminalFooter/></div>;
}
