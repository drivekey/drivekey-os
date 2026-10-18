'use client';
import {useEffect,useState} from 'react';
import {LIVE_RELEASE} from '@/core/live-release-policy';
import {isMultiWallet} from '@/core/app-wallet';
import {usePublicWallet} from './wallet-context';
export type Capabilities={paths:Record<string,{enabled:boolean;dependency:string}>;ethereum:{configured:boolean;settlementVerified:boolean};solana:{configured:boolean;settlementVerified:boolean};agents:{enabled:boolean;configured:boolean;settlementVerified:boolean};husher:{enabled:boolean;configured:boolean;ownerOnly:boolean;privateEnabled:boolean;settlementVerified:boolean}};
export function useCapabilities(){const[value,setValue]=useState<Capabilities|null>(null);useEffect(()=>{let alive=true;fetch('/api/capabilities',{cache:'no-store',signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{if(alive)setValue(v);}).catch(()=>{});return()=>{alive=false;};},[]);return value;}
export function FeatureStatus({feature}:{feature:'agents'|'husher'|'swap'}) {
  const c=useCapabilities(),w=usePublicWallet();
  const message=!LIVE_RELEASE.fundedExecution?LIVE_RELEASE.reason:!c?'Checking availability…'
    :feature==='agents'?!c.agents.configured?'Connect your agent companion to continue.':null
    :feature==='husher'?!c.husher.configured?'Husher is not configured yet.':null
    :!isMultiWallet(w.wallet)?'Connect a multichain public wallet to swap.':null;
  return message?<div className="feature-status" role="status"><span className="status-dot" aria-hidden="true"/><strong>{message}</strong></div>:null;
}
