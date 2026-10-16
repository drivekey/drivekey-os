"use client";
import Link from "next/link";
import WalletHome from "./wallet-home";
import {isMultiWallet,readPublicWalletFile} from '@/core/app-wallet';
import {usePublicWallet} from "./wallet-context";
import { useEffect, useState } from "react";
import { multiPublicSchema, validateMultiRequest, verifyMultiResponse, multiReview, type MultiPublic, type MultiRequest, type MultiResponse } from "@/core/multi-protocol";
import { holdingSchema, type Holding } from "@/core/portfolio";
import { parseJson } from "@/core/protocol";
import { TerminalHeader, TerminalFooter } from "./terminal-chrome";
import {MultiSubmission,assertNoPendingMulti} from './multi-submission';
import {ReleaseDownload} from './release-download';
import {SolanaReadiness,solanaWalletId,type SolanaSelection} from './solana-readiness';
import {checkPreparedMultiIntent} from '@/core/prepared-intent';
import {PaymentRoute} from './payment-route';
import {WalletPageHeader} from './wallet-page-header';
const SESSION = "drivekey-multi-experimental-v3";
async function api(input: unknown) { const r = await fetch("/api/assets", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}); const data = await r.json(); if (!r.ok || data.error) throw new Error(data.error || "Request failed."); return data; }
function download(name: string, data: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})); const a = document.createElement("a"); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function fileJson(file: File) { if(file.size>32768)throw new Error("File too large. Public files only.");return parseJson(await file.text()); }
export default function AssetsWorkflow() {
  const sharedWallet=usePublicWallet();
  const [route,setRoute]=useState<'direct'|'husher'>('direct');
  const [wallet,setWallet]=useState<MultiPublic|null>(null),[holdings,setHoldings]=useState<Holding[]>([]),[candidate,setCandidate]=useState<Holding|null>(null);
  const [network,setNetwork]=useState<"robinhood"|"solana">("solana"),[token,setToken]=useState("native"),[recipient,setRecipient]=useState(""),[amount,setAmount]=useState(""),[selection,setSelection]=useState<SolanaSelection|null>(null);
  const nonceAccount=wallet&&selection?.walletId===solanaWalletId(wallet)?selection.address:'';
  const [request,setRequest]=useState<MultiRequest|null>(null),[signed,setSigned]=useState<MultiResponse|null>(null),[approved,setApproved]=useState(false),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[now,setNow]=useState(0);
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),30_000);try{const raw=localStorage.getItem(SESSION);if(raw){const state=parseJson(raw) as {wallet:unknown;request:unknown};const w=multiPublicSchema.parse(state.wallet),r=validateMultiRequest(state.request,Date.now(),false);if(r.deviceId!==w.deviceId)throw Error("Different wallet.");setWallet(w);setRequest(r);setNetwork(r.network);setToken(r.token);setMessage("Saved request restored. Upload the response again to verify; nothing sends automatically.");}}catch{setMessage("Saved request could not be restored. No action was taken.");}return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(!request&&!localStorage.getItem(SESSION)){setWallet(isMultiWallet(sharedWallet.wallet)?sharedWallet.wallet:null);setHoldings([]);setCandidate(null);if(sharedWallet.network!=="ethereum")setNetwork(sharedWallet.network);}},[sharedWallet.wallet,sharedWallet.network,request]);
  useEffect(()=>{if(!wallet)return;try{const data=JSON.parse(localStorage.getItem('drivekey-tracked:'+wallet.deviceId)||'[]');if(Array.isArray(data))setHoldings(data.slice(0,20).map(v=>holdingSchema.parse(v)));}catch{setMessage('Saved tracked assets could not be read.');}},[wallet]);
  async function run(action:()=>Promise<void>) { if(busy)return;setBusy(true);setMessage("");try{await action();}catch(e){setMessage(e instanceof Error?e.message:"Action stopped.");}finally{setBusy(false);} }
  function invalidate() {if(wallet){try{assertNoPendingMulti(wallet,network);}catch(e){setMessage(e instanceof Error?e.message:'Reconcile the previous attempt.');return false;}}setRequest(null);setSigned(null);setApproved(false);localStorage.removeItem(SESSION);return true;}
  if(sharedWallet.wallet&&!isMultiWallet(sharedWallet.wallet)&&!request)return <WalletHome title="Assets"/>;
  return <div className="terminal-app"><TerminalHeader/><main id="main" className="assets-main"><WalletPageHeader title="Assets" description="Track tokens and prepare transfers." actions={<Link className="wallet-pill" href="/app/manual">Send Robinhood ETH</Link>}/>
    <details className="assets-form"><summary>Supported assets and offline signer</summary><p>Supports Solana SOL and classic SPL tokens, plus canonical Robinhood WETH and USDG. Other Robinhood ERC-20 contracts are unsupported.</p><p>Robinhood WETH requires RC10; USDG requires RC11. Native ETH is available in Send.</p><ReleaseDownload kind="image"/><p><a href="/api/private-signer?version=rc10" download>Download RC10 · Robinhood WETH</a></p><p><a href="/api/private-signer?version=rc11" download>Download RC11 · Robinhood USDG</a></p><Link href="/app/setup">Setup guide ↗</Link></details>
    {message&&<p role="status" className="assets-notice">{message}</p>}
    <section className="assets-form"><h2>Connect your wallet</h2><p>Import wallet-multi-public.json. Never upload an encrypted vault or enter your passphrase here.</p><label htmlFor="multi-wallet">Public wallet file</label><input id="multi-wallet" type="file" accept=".json" disabled={busy||!!request} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void run(async()=>{const w=multiPublicSchema.parse(await readPublicWalletFile(f));sharedWallet.importWallet(w);setWallet(w);setHoldings([]);setCandidate(null);});}}/>{wallet&&<pre>{`Robinhood: ${wallet.evmAddress}\nSolana:    ${wallet.solanaAddress}`}</pre>}</section>
    <section className="assets-form"><h2>Add an asset</h2><label htmlFor="multi-network">Network</label><select id="multi-network" value={network} disabled={busy||!!request} onChange={e=>{invalidate();setNetwork(e.target.value as typeof network);setToken("native");setCandidate(null);}}><option value="solana">Solana mainnet</option><option value="robinhood">Robinhood Chain · 4663</option></select><label htmlFor="multi-token">Token address, or native</label><input id="multi-token" value={token} disabled={busy||!!request} onChange={e=>{invalidate();setToken(e.target.value);setCandidate(null);}} spellCheck={false}/><button disabled={!wallet||busy||!!request} onClick={()=>void run(async()=>{setCandidate(null);const r=await api({action:"inspect",wallet,network,token});if(r.unsupported)throw Error(r.unsupported);setCandidate(holdingSchema.parse(r.holding));})}>Check asset</button>
    {candidate&&<div className="asset-review"><h3>{candidate.name} / {candidate.symbol}</h3><p>{candidate.network} · {candidate.address}</p><p>{candidate.decimals} decimals · {candidate.quantity} base units</p>{candidate.warning&&<p>{candidate.warning}</p>}<button onClick={()=>{try{if(!wallet||!candidate.supported)throw Error('Only verified supported assets can be tracked.');const next=[...holdings.filter(h=>!(h.network===candidate.network&&h.address===candidate.address)),candidate].slice(-20);localStorage.setItem('drivekey-tracked:'+wallet.deviceId,JSON.stringify(next));setHoldings(next);setCandidate(null);}catch(e){setMessage(e instanceof Error?e.message:'Tracking unavailable.');}}}>Track in Overview</button></div>}</section>
    {wallet&&network==="solana"&&!request&&<SolanaReadiness key={solanaWalletId(wallet)} wallet={wallet} disabled={busy} onBusy={setBusy} onReady={setSelection}/>}
    <section className="assets-form" aria-label="Prepare exact transfer"><h2>Prepare a transfer</h2><p>Selected: {network} / {token}</p><label htmlFor="multi-recipient">Recipient address</label><input id="multi-recipient" value={recipient} disabled={busy||!!request} onChange={e=>{invalidate();setRecipient(e.target.value);}} spellCheck={false}/><label htmlFor="multi-amount">Token amount</label><input id="multi-amount" value={amount} disabled={busy||!!request} onChange={e=>{invalidate();setAmount(e.target.value);}} inputMode="decimal"/>
    <PaymentRoute value={route} onChange={setRoute} disabled={busy||!!request}/>
    <button disabled={route!=='direct'||!wallet||busy||!!request||(network==='solana'&&!nonceAccount)} onClick={()=>void run(async()=>{if(route!=='direct'||!wallet)return;if(network==='solana'&&!nonceAccount)throw Error('Complete the Solana setup check first.');assertNoPendingMulti(wallet,network);const data=await api({action:"prepare",wallet,network,token,recipient,amount,nonceAccount});const r=checkPreparedMultiIntent(data.request,{wallet,network,token,recipient,amount,nonceAccount});const serialized=JSON.stringify({wallet,request:r});localStorage.setItem(SESSION,serialized);if(localStorage.getItem(SESSION)!==serialized)throw Error("Could not persist the exact request.");setRequest(r);setApproved(false);})}>Prepare unsigned request</button>
    <p role="status" aria-live="polite" data-testid="prepare-feedback">{busy?"Working…":message}</p>
    {!wallet&&<p>Connect your public wallet to prepare a transfer.</p>}
    {request&&<><dl className="asset-review">{Object.entries(multiReviewForDisplay(request)).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><label><input type="checkbox" checked={approved} onChange={e=>{setApproved(e.target.checked);setSigned(null);}}/>I reviewed full recipient, network, asset, base units and fees.</label><button disabled={!approved||busy||now>=Date.parse(request.expiresAt)} onClick={()=>void run(async()=>{validateMultiRequest(request);download("unsigned-multi-request.json",request);setMessage("Save unsigned-multi-request.json in the USB DriveKey folder. Use the matching offline signer version shown in the review, then shut down fully.");})}>Download unsigned request</button> <button onClick={()=>{if(invalidate())setMessage("Request discarded locally. This does not revoke bytes already signed.");}}>Discard request</button></>}
    </section><section className="assets-form"><h2>Verify your signed response</h2><label htmlFor="multi-response">signed-multi-response.json</label><input id="multi-response" type="file" accept=".json" disabled={!wallet||!request||!approved||busy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void run(async()=>{setSigned(null);const s=verifyMultiResponse(await fileJson(f),request,wallet);setSigned(s);setMessage("Verified — not sent. Signature, bytes and approval context match.");});}}/>{signed&&<pre>{signed.transactionHash}</pre>}<p>Verification does not send funds. You approve submission separately.</p></section>
    {wallet&&request&&signed&&<section className="assets-form"><MultiSubmission wallet={wallet} request={request} response={signed}/></section>}
  </main><TerminalFooter/></div>;
}
function multiReviewForDisplay(r: MultiRequest) { try{return multiReview(r);}catch{return {state:"Expired or invalid request. Prepare a fresh one; do not change your clock to bypass expiry."};} }






