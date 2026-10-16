"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Minus, Plus } from "lucide-react";
import { CharacterField } from './character-field';
import type {AccountNetwork} from '@/core/app-wallet';
import {WalletHeader,WalletFooter} from './wallet-chrome';

export function TerminalHeader({transactionNetwork}:{transactionNetwork?:AccountNetwork}={}) { return <WalletHeader transactionNetwork={transactionNetwork}/>; }

export function TerminalBar({name,meta}:{name:string;meta?:string}) {
  return <div className="terminal-bar"><span className="window-controls" aria-hidden="true"><i/><i/><i/></span><span>{name}</span><span className="terminal-bar-meta">{meta}<Minus size={12}/><Plus size={12}/></span></div>;
}

export function TerminalFooter() { return <WalletFooter/>; }

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
