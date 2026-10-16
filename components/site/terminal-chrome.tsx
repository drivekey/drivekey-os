"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Minus, Plus } from "lucide-react";
import { CharacterField } from './character-field';

export function TerminalHeader() {
  const pathname = usePathname();
  const [compact,setCompact] = useState(false);
  useEffect(()=>{const update=()=>setCompact(window.scrollY>80);update();window.addEventListener('scroll',update,{passive:true});return()=>window.removeEventListener('scroll',update);},[]);
  return <><CharacterField/><header className={`terminal-header ${compact?'is-compact':''}`}>
    <Link href="/" className="terminal-brand" aria-label="DriveKey home"><Image src="/brand/mark.png" alt="" width={27} height={36} unoptimized/><span>DRIVEKEY<span className="brand-cursor">_</span></span></Link>
    <nav aria-label="Main navigation"><Link href="/" aria-current={pathname==='/'?'page':undefined}>01 <span>Home</span></Link><Link href="/setup" aria-current={pathname==="/setup"?"page":undefined}>02 <span>Setup</span></Link><a href="/#holder-benefits" className="holder-nav-link">03 <span>Benefits</span></a><a href="/app">04 <span>Open app</span></a></nav>
    <a href="/#security" className="header-security">Security / FAQ <ArrowUpRight size={14}/></a>
  </header></>;
}

export function TerminalBar({name,meta}:{name:string;meta?:string}) {
  return <div className="terminal-bar"><span className="window-controls" aria-hidden="true"><i/><i/><i/></span><span>{name}</span><span className="terminal-bar-meta">{meta}<Minus size={12}/><Plus size={12}/></span></div>;
}

export function TerminalFooter() {
  return <footer className="terminal-footer">
    <span>DRIVEKEY / OFFLINE SIGNING</span>
    <div className="footer-links"><Link href="/#security">Security & limitations</Link><Link href="/setup">Setup guide</Link><Link href="/#holder-benefits">Holder benefits</Link><Link href="/assets">Multi-asset lab</Link><a href="https://x.com/DriveKeyyy" target="_blank" rel="noopener noreferrer">X / @DriveKeyyy ↗</a></div>
    <div className="footer-token"><span>DRIVEKEY / TOKEN ADDRESS</span><code>0x583b10d1912e8d3def8709a6c1cb7ac88fa27fd7</code></div>
  </footer>;
}

export const ETH_CHARACTER = `             ▄
            ▄█▄
           ▄█▓█▄
          ▄██▓██▄
         ▄███▓███▄
        ▄████▓████▄
       ▄█████▓█████▄
      ▄██████▓██████▄
     ▀▀██████▓██████▀▀
        ▀▀███▓███▀▀
           ▀█▓▀
      ▄      ▀      ▄
       ▀██▄▄   ▄▄██▀
         ▀███▓███▀
           ▀█▓█▀
             ▀`;

export function EthCharacters({className=''}:{className?:string}) {
  return <pre className={`eth-characters ${className}`} aria-hidden="true">{ETH_CHARACTER}</pre>;
}

export function CharacterAllocation({funded}:{funded:boolean}) {
  const rows=Array.from({length:13},(_,y)=>Array.from({length:27},(_,x)=>{
    const d=((x-13)/12.5)**2+((y-6)/6)**2;
    if(d>1)return ' ';
    if(!funded)return d>.66?'·':' ';
    return x<13?'▓':'█';
  }).join('')).join('\n');
  return <pre className={`allocation-chart ${funded?'is-funded':''}`} aria-hidden="true">{rows}</pre>;
}
