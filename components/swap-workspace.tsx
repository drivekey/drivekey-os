'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {TerminalHeader,TerminalFooter} from './terminal-chrome';
import {WalletPageHeader} from './wallet-page-header';

const Lifi=dynamic(()=>import('./lifi-quotes').then(m=>m.LifiQuotes));
const Husher=dynamic(()=>import('./husher-workspace'));
const Direct=dynamic(()=>import('./payments-workspace'));
const Conversion=dynamic(()=>import('./weth-conversion').then(m=>m.WethConversion));
const providers=[
 {id:'lifi',name:'LI.FI',detail:'Ethereum · ETH → USDC'},
 {id:'jupiter',name:'Jupiter',detail:'Solana · SOL ↔ USDC',logo:'/brand/jupiter-logo.png'},
 {id:'husher',name:'Husher',detail:'ETH → USDC · standard exchange',logo:'/brand/husher-mark.png'},
 {id:'direct',name:'Uniswap',detail:'Ethereum · WETH ↔ USDC',logo:'/brand/uniswap-icon.svg'},
] as const;
type Provider=typeof providers[number]['id'];
export default function SwapWorkspace(){
 const [selected,setSelected]=useState<Provider>('lifi');
 const [visited,setVisited]=useState<Provider[]>(['lifi']);
 function choose(provider:Provider){setSelected(provider);setVisited(old=>old.includes(provider)?old:[...old,provider]);const url=new URL(location.href);url.searchParams.set('provider',provider);history.replaceState(null,'',url);}
 useEffect(()=>{
  const query=new URLSearchParams(location.search),requested=query.get('provider');
  if(providers.some(p=>p.id===requested)){choose(requested as Provider);return;}
  // This only selects a panel. Its workspace validates the full saved request.
  if(query.has('restore')){try{const records=JSON.parse(localStorage.getItem('drivekey-payments-rc-v1')||'[]');const record=Array.isArray(records)?records.find(r=>r.id===query.get('restore')):null;if(record){choose(record.network==='solana'?'jupiter':'direct');return;}}catch{/* The workspace reports unreadable history. */}}
  if(query.get('network')==='solana')choose('jupiter');else if(query.get('network')==='ethereum'||query.has('restore'))choose('direct');
 },[]);
 return <div className="terminal-app payments-app"><TerminalHeader transactionNetwork={selected==='direct'?'ethereum':selected==='jupiter'?'solana':undefined}/><main id="main" className="payments-shell">
  <WalletPageHeader title="Swap" description="Choose a provider."/>
  <div className="payments-provider-tabs swap-provider-choices" role="group" aria-label="Swap provider">{providers.map(provider=><button key={provider.id} aria-pressed={selected===provider.id} aria-controls={'swap-'+provider.id} onClick={()=>choose(provider.id)}><span>{'logo' in provider&&<Image src={provider.logo} width={24} height={24} alt=""/>}{provider.name}</span><small>{provider.detail}</small></button>)}</div>
  {providers.map(provider=><section key={provider.id} id={'swap-'+provider.id} hidden={selected!==provider.id} aria-label={provider.name+' workspace'}>{visited.includes(provider.id)&&(provider.id==='lifi'?<Lifi/>:provider.id==='husher'?<Husher embedded/>:<>{provider.id==='direct'&&<Conversion/>}<Direct mode="swap" embedded swapNetwork={provider.id==='jupiter'?'solana':'ethereum'}/></>)}</section>)}
 </main><TerminalFooter/></div>;
}
