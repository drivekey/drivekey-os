"use client";
import Link from "next/link";
import {ApprovalSteps} from "./approval-steps";
import {usePublicWallet} from "./wallet-context";
import {isMultiWallet} from "@/core/app-wallet";
import {parsePaymentLink} from "@/core/payment-request";
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Check, ChevronRight, Copy, FileCheck2, LockKeyhole, RefreshCw, ShieldCheck, Usb } from "lucide-react";
import { formatEther, isAddress, parseEther } from "ethers";
import { FILES, publicWallet, validateRequest, verifyResponse } from "@/core/protocol";
import { MANUAL_SESSION } from "@/core/manual-session";
import { formatUtc, formatZonedTime, validTimeZone } from "@/core/utc-display";
import { Button, Card, Input } from "./ui";
import { CharacterAllocation, EthCharacters, TerminalBar, TerminalFooter, TerminalHeader } from "./terminal-chrome";
import { downloadTransfer, readTransferFile, transferApi, useManualTransfer } from "./use-manual-transfer";
import { PaymentRoute } from './payment-route';
import { WalletPageHeader } from './wallet-page-header';

export default function ManualWorkflow() {
  const d=useManualTransfer();
  const shared=usePublicWallet();
  useEffect(()=>{if(shared.hydrated&&!localStorage.getItem(MANUAL_SESSION)&&!d.request&&!d.busy){d.setWallet(shared.wallet&&!isMultiWallet(shared.wallet)?shared.wallet:null);}},[shared.wallet,shared.hydrated,d.request,d.busy,d.setWallet]);
  useEffect(()=>{if(location.hash.startsWith("#request=")&&!localStorage.getItem(MANUAL_SESSION)){try{const p=parsePaymentLink(location.href);if(p.network!=="robinhood")return;d.setRecipient(p.recipient);d.setAmount(p.amount||"");}catch{d.setMessage("Invalid payment link. Nothing was prepared.");}}},[d.setRecipient,d.setAmount,d.setMessage]);
  const [route,setRoute]=useState<'direct'|'husher'>('direct');
  const {wallet,request,signed,attempt,recipient,amount,consent,sendConsent,enabled,lockSupport,busy,message,balance,now,expired,remaining,complete,run,owned,prepare,send,receipt}=d;
  const [balanceState,setBalanceState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [balanceTime,setBalanceTime]=useState('');
  const [playReceipt,setPlayReceipt]=useState(false);
  const [copied,setCopied]=useState(false);
  const [timeZone,setTimeZone]=useState('');
  const [timeZoneConfirmed,setTimeZoneConfirmed]=useState(false);
  const [detectedZone,setDetectedZone]=useState('UTC');
  const [timeZones,setTimeZones]=useState<string[]>(['UTC','Europe/Warsaw','Europe/London','America/New_York','Asia/Kolkata']);
  useEffect(()=>{
    const detected=Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setDetectedZone(detected);
    let saved: string | null = null;
    try { saved=localStorage.getItem('drivekey.display-timezone'); } catch { /* Storage is optional. */ }
    setTimeZone(saved&&validTimeZone(saved)?saved:detected);
    if(typeof Intl.supportedValuesOf==='function')setTimeZones(Array.from(new Set(['UTC',detected,...Intl.supportedValuesOf('timeZone')])));
  },[]);
  function selectTimeZone(zone:string){
    setTimeZoneConfirmed(false);
    setTimeZone(zone);
    if(validTimeZone(zone))try { localStorage.setItem('drivekey.display-timezone',zone); } catch { /* Keep the session preference. */ }
  }
  const confirmed=attempt?.state==='confirmed';

  useEffect(()=>{
    if(!wallet){setBalanceState('idle');return;}
    let cancelled=false;
    setBalanceState('loading');d.setBalance(null);
    transferApi({action:'balance',wallet}).then(r=>{
      if(r.chainId!==4663||typeof r.wei!=='string'||!/^\d+$/.test(r.wei))throw Error('Invalid balance');
      if(!cancelled){d.setBalance(formatEther(r.wei));setBalanceState('ready');setBalanceTime(new Date().toISOString());}
    }).catch(()=>{if(!cancelled){d.setBalance(null);setBalanceState('error');}});
    return()=>{cancelled=true;};
  },[wallet,confirmed,d.setBalance]);

  async function checkBalance(check:()=>void){
    if(!wallet)return;
    setBalanceState('loading');d.setBalance(null);
    try{
      const r=await transferApi({action:'balance',wallet});
      check();if(r.chainId!==4663||typeof r.wei!=='string'||!/^\d+$/.test(r.wei))throw Error('Invalid balance response.');
      d.setBalance(formatEther(r.wei));setBalanceState('ready');setBalanceTime(new Date().toISOString());
    }catch(e){check();setBalanceState('error');throw e;}
  }

  const activeStep=signed||attempt?3:request?2:wallet?1:0;
  const funded=balance!==null&&parseEther(balance)>0n;
  const sent=attempt&&['submitted','pending','confirmed'].includes(attempt.state);
  const stateTitle=attempt?(sent?confirmed?'Confirmed':'Sent':attempt.state==='reverted'?'Reverted':attempt.state==='verified-only'?'Verified':'Check status'):signed?'Verified':'Awaiting signature';
  const clock=now===null?'—':formatUtc(now);
  const clockReady=timeZoneConfirmed&&validTimeZone(timeZone)&&now!==null;

  return <div className="terminal-app"><TerminalHeader/><main id="main" className="transfer-main">
    <WalletPageHeader title="Send" description="Send ETH on Robinhood Chain with offline approval." actions={<span className="wallet-network-badge">Robinhood Chain · 4663</span>}/>
    <ApprovalSteps step={activeStep}/>{isMultiWallet(shared.wallet)&&!request&&<p className="wallet-message">For Robinhood ETH, import wallet-public.json from your offline wallet. For Ethereum or Solana, change the selected network.</p>}
    <section className="transfer-message transfer-clock" aria-label="UTC clock">
      <h2 className="timezone-heading">Check your time</h2>
      <div className="timezone-control"><label htmlFor="display-timezone">Your timezone</label><Input id="display-timezone" list="display-timezones" value={timeZone} onChange={e=>selectTimeZone(e.target.value)} placeholder="Europe/Warsaw" autoComplete="off" spellCheck={false} aria-invalid={!validTimeZone(timeZone)} aria-describedby="timezone-help"/><datalist id="display-timezones">{timeZones.map(zone=><option key={zone} value={zone}/>)}</datalist><Button variant="secondary" onClick={()=>selectTimeZone(detectedZone)}>Use browser timezone</Button></div>
      <p id="timezone-help">Browser timezone: {detectedZone}.</p>
      {!validTimeZone(timeZone)&&<p role="status">Enter a timezone such as Europe/Warsaw or select one from the list.</p>}
      <div className="timezone-clocks"><div><span>Your local time{validTimeZone(timeZone)?` · ${timeZone}`:''}</span><time data-testid="current-local">{now===null?'—':formatZonedTime(now,timeZone)}</time></div><div><span>Current UTC · use UTC on the offline USB</span><time data-testid="current-utc">{clock}</time></div></div>
      <p>Both clocks use your computer’s time. Check it against an independent clock.</p>
      <label className="transfer-check"><input type="checkbox" checked={timeZoneConfirmed} disabled={!validTimeZone(timeZone)||now===null} onChange={e=>setTimeZoneConfirmed(e.target.checked)}/> This is my timezone, and the local date and time above match my current time.</label>
      <p role="status">{clockReady?'Time confirmed. Requests use UTC.':'Confirm the time to prepare a request.'}</p>
      <p>Before signing, compare the USB’s UTC clock with an independent UTC clock. If they differ, stop. Never change a request deadline to compensate.</p>
      <details className="offline-help"><summary>Offline clock help</summary><p>Use the ISO that matches your hardware clock convention. Z means UTC.</p></details>
    </section>
    {message&&<p role="status" className="transfer-message"><span aria-hidden="true">&gt;</span>{message}</p>}
    <div className="transfer-layout"><div className="transfer-workspace">
      <Card className="transfer-panel wallet-panel"><div className="transfer-panel-body">
        <div className="panel-heading"><h2>Connect your wallet</h2><Usb size={21}/></div>
        <p className="transfer-muted">Import the public file exported from your offline wallet.</p>
        <label htmlFor="manual-wallet">wallet-public.json</label><Input id="manual-wallet" type="file" accept=".json" disabled={busy||!!request} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async(check)=>{const imported=publicWallet(await readTransferFile(f,FILES.metadata));check();shared.importWallet(imported);d.setBalance(null);d.setWallet(imported);setCopied(false);});}}/>
        {wallet&&<div className="loaded-wallet"><Check size={15}/><code className="dk-full-address">{wallet.address}</code></div>}
        <p className="transfer-note">Public metadata only. Never upload vault-encrypted.json or enter your vault passphrase here.</p>
      </div></Card>

      <Card className={`transfer-panel prepare-panel ${request?'has-request':''}`}><div className="transfer-panel-body">
        <div className="panel-heading"><h2>Recipient and amount</h2><ArrowUpRight size={21}/></div>
        <PaymentRoute value={route} onChange={setRoute} disabled={busy||!!request}/>
        <form onSubmit={e=>{e.preventDefault();if(route!=='direct')return;if(!clockReady){d.setMessage('Confirm your timezone and local time above before preparing a request.');return;}setPlayReceipt(false);void run(prepare);}}>
          <label htmlFor="manual-recipient">Recipient address</label><div className={`terminal-field ${isAddress(recipient)?'field-valid':''}`}><span className="field-prompt" aria-hidden="true">&gt;</span><Input id="manual-recipient" value={recipient} onChange={e=>d.setRecipient(e.target.value)} disabled={busy||!!request} placeholder="0x · full recipient address" spellCheck={false} autoComplete="off"/>{isAddress(recipient)&&<Check size={15} aria-label="Valid address format"/>}</div>
          <label htmlFor="manual-amount">ETH amount</label><div className={`terminal-field amount-field ${amount?'field-entered':''}`}><span className="field-prompt" aria-hidden="true">&gt;</span><Input id="manual-amount" value={amount} onChange={e=>d.setAmount(e.target.value)} disabled={busy||!!request} inputMode="decimal" autoComplete="off" placeholder="0.0000"/><span className="field-unit">ETH</span></div>
          <div className="input-footnote"><span>Native ETH only</span><span>Limit: 0.005 ETH</span></div>
          {!request&&!clockReady&&<p className="transfer-note">First confirm your timezone and local time above.</p>}
          <Button type="submit" disabled={!clockReady||route!=='direct'||!wallet||busy||!!request||!recipient||!amount}>Prepare request <ArrowUpRight size={16}/></Button>
        </form>
        {request&&<div className="transfer-review"><div className="review-title"><h3>Review transfer</h3><span>{expired?'EXPIRED':'PREPARED'}</span></div><dl>
          <dt>From</dt><dd className="dk-full-address">{request.from}</dd><dt>Recipient</dt><dd className="dk-full-address">{request.to}</dd><dt>Network</dt><dd>Robinhood Chain · 4663 · native ETH</dd><dt>Amount</dt><dd className="review-amount">{formatEther(request.value)} ETH</dd><dt>Maximum fee</dt><dd>{formatEther(BigInt(request.gasLimit)*BigInt(request.maxFeePerGas))} ETH</dd><dt>Maximum total debit</dt><dd>{formatEther(BigInt(request.value)+BigInt(request.gasLimit)*BigInt(request.maxFeePerGas))} ETH</dd><dt>Nonce</dt><dd>{request.nonce}</dd><dt>Signing deadline (UTC — not current time)</dt><dd className={expired?'deadline-expired':''}>{formatUtc(request.expiresAt)}{remaining!==null&&<span className="deadline-remaining">{remaining} minutes left</span>}</dd><dt>Fingerprint</dt><dd className="dk-full-address">{request.fingerprint}</dd>
          <dt>Signing deadline in your timezone</dt><dd data-testid="local-deadline">{validTimeZone(timeZone)?`${formatZonedTime(request.expiresAt,timeZone)} · ${timeZone}`:'Select a valid timezone above.'}</dd>
        </dl>{expired&&<p className="transfer-warning">Request expired. Prepare a fresh request for offline approval. Do not turn the clock back to sign it. A deadline does not revoke bytes already signed.</p>}
          <label className="transfer-check"><input type="checkbox" checked={consent} disabled={busy||!!attempt} onChange={e=>{d.setConsent(e.target.checked);d.setSendConsent(false);}}/> I checked the recipient, network, amount and maximum fee.</label>
          <Button disabled={!consent||busy||expired||!!attempt} onClick={()=>void run(async(check)=>{owned();validateRequest(request);downloadTransfer(FILES.request,request);d.setMessage('Save unsigned-request.json in the USB DriveKey folder. Finish signing within the displayed deadline.');})}><ArrowDownToLine size={16}/> Download unsigned-request.json</Button>
          {consent&&!busy&&!expired&&!attempt&&<details className="offline-help"><summary>Download not working? Save the request text</summary><p>Save this exact text as <code>unsigned-request.json</code> in the USB’s <code>DriveKey</code> folder. This contains public transaction data only. Do not edit it.</p><textarea aria-label="Unsigned request JSON" readOnly value={JSON.stringify(request,null,2)} rows={12} spellCheck={false} style={{width:'100%',fontFamily:'monospace',fontSize:'12px'}}/></details>}
        </div>}
      </div></Card>

      <Card className="transfer-panel offline-panel"><div className="transfer-panel-body"><div className="panel-heading"><h2>Approve offline</h2><LockKeyhole size={21}/></div><ol className="offline-instructions"><li><span>01</span><div>Save the request in the USB’s <code>DriveKey</code> folder.</div></li><li><span>02</span><div>Boot the USB with networking disconnected. Check UTC, then review and sign locally.</div></li><li><span>03</span><div>Shut down fully. Return to this exact URL in the same Windows browser.</div></li></ol><details className="offline-help"><summary>Using the older command-line signer?</summary><p>Run <code>sudo drivekey-offline sign</code> and enter your passphrase only there. Finish with <code>sudo poweroff</code>. A VM is for unfunded tests, not your real wallet.</p></details></div></Card>

      <Card className="transfer-panel response-panel"><div className="transfer-panel-body"><div className="panel-heading"><h2>Verify and send</h2><ArrowUpFromLine size={21}/></div><p className="transfer-muted">Import your signed response to check it before sending.</p><label htmlFor="manual-response">signed-response.json</label><Input id="manual-response" type="file" accept=".json" disabled={!request||!wallet||!consent||busy||!!attempt||expired} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async(check)=>{d.setSigned(null);d.setSendConsent(false);if(!request||!wallet)return;owned();const s=verifyResponse(await readTransferFile(f,FILES.response),request,wallet);check();owned();d.setSigned(s);d.setMessage('Signature verified locally. No transaction was broadcast.');});}}/>
        {signed&&!attempt&&<div className="manual-verified"><ShieldCheck size={22}/><h3>Verified — not sent</h3><code className="dk-full-address">{signed.transactionHash}</code><p>The signer and exact transaction match your saved request.</p></div>}
        {!enabled&&!attempt&&<div className="submission-lock"><LockKeyhole size={15}/><span>Sending is disabled in this preview.</span></div>}
        {signed&&enabled&&!attempt&&<label className="transfer-check"><input type="checkbox" checked={sendConsent} onChange={e=>d.setSendConsent(e.target.checked)} disabled={busy||expired}/> I authorize sending this exact signed transfer now, including its maximum fee.</label>}
        {!attempt&&<Button disabled={!enabled||!signed||!consent||!sendConsent||busy||expired||!lockSupport} onClick={()=>void run(async(check)=>{await send();check();setPlayReceipt(true);})}>{enabled?busy?'Checking…':'Send exact transaction':'Send locked'}<ArrowUpRight size={16}/></Button>}
        {!lockSupport&&enabled&&<p className="transfer-note">Sending requires a browser with Web Locks support to coordinate tabs.</p>}
        {attempt&&<div className={`manual-result ${sent?'is-sent':''} ${playReceipt&&sent?'animate-result':''}`} data-state={attempt.state}>
          {sent&&<div className="eth-sweep"><EthCharacters/></div>}
          <div className="receipt-content"><span className="receipt-label">TRANSACTION RECEIPT</span><div className="receipt-state">{stateTitle}<span aria-hidden="true">_</span></div><h3>Transaction {attempt.state}</h3>
            {request&&<dl className="receipt-summary"><dt>Amount</dt><dd>{formatEther(request.value)} ETH</dd><dt>Recipient</dt><dd className="dk-full-address">{request.to}</dd><dt>Network</dt><dd>Robinhood Chain / 4663</dd></dl>}
            <span className="receipt-hash-label">Transaction hash</span><code className="dk-full-address">{attempt.hash}</code><p>{confirmed?'Included successfully. L1 settlement finality is a separate stage.':sent?'Submitted to the network. Check the receipt for confirmation.':'No confirmed send. Check this hash before taking another action.'}</p>
            <div className="receipt-actions"><Button variant="secondary" disabled={busy} onClick={()=>void run(receipt)}><RefreshCw size={14}/>Check transaction status</Button><a href={`https://robinhoodchain.blockscout.com/tx/${attempt.hash}`} target="_blank" rel="noreferrer">View exact hash in explorer ↗</a></div></div>
        </div>}
        <div className="workflow-clear"><Button variant="ghost" disabled={busy||(!!attempt&&!complete)} onClick={()=>void run(async(check)=>{if(!window.confirm('Clearing does not revoke an existing signature. Have you reconciled any previous transaction?'))return;await d.clearSession();check();d.setRequest(null);d.setSigned(null);d.setAttempt(undefined);d.setConsent(false);d.setSendConsent(false);setPlayReceipt(false);d.setMessage('Workflow cleared. Previously signed transactions are not revoked.');})}>Clear manual workflow</Button></div>
      </div></Card>
    </div><aside className="transfer-sidebar" aria-label="Wallet balance and transaction summary">
      <section className="portfolio-terminal"><TerminalBar name="vault / balance"/><div className="portfolio-body"><div className="portfolio-heading"><span>AVAILABLE FUNDS</span><Button variant="ghost" aria-label="Check balance" disabled={!wallet||busy||balanceState==='loading'} onClick={()=>void run(checkBalance)}><RefreshCw size={14} className={balanceState==='loading'?'balance-loading':''}/></Button></div><div className="portfolio-value" data-testid="wallet-balance">{balance===null?'—':balance}<span>ETH</span></div><p className="portfolio-balance-status">{!wallet?'Load a public wallet to check its balance.':balanceState==='loading'?'Reading balance…':balanceState==='error'?'Balance unavailable. Try refreshing.':balanceTime?`Checked ${balanceTime.slice(11,19)} UTC`:'Balance not checked'}</p>
        <div className="allocation" role="img" aria-label={funded?'ETH accounts for 100 percent of the supported holdings':balance!==null&&!funded?'No ETH holdings': 'Allocation unavailable until balance is checked'}><CharacterAllocation funded={funded}/><div><span>ALLOCATION</span><strong>{funded?'100%':balance!==null&&!funded?'0%':'—'}</strong><span>ETH</span></div></div><div className="allocation-legend"><span><i/> Ethereum</span><span>{funded?'100%':balance!==null&&!funded?'0%':'—'}</span></div><p className="transfer-note">Native ETH is the only supported asset.</p>
        {wallet&&<div className="portfolio-address"><span>PUBLIC ADDRESS</span><code className="dk-full-address">{wallet.address}</code><button type="button" onClick={()=>void run(async(check)=>{await navigator.clipboard.writeText(wallet.address);check();setCopied(true);})}>{copied?<Check size={13}/>:<Copy size={13}/>} {copied?'Copied':'Copy address'}</button><p>Compare this address with your offline console before funding.</p></div>}
      </div></section>
      <section className="session-terminal"><TerminalBar name="request / monitor"/><div className="session-body"><p><span>&gt; amount</span><strong className="input-echo">{request?formatEther(request.value):amount||'0.0000'} ETH</strong></p><p><span>&gt; network</span><strong>4663 / Robinhood</strong></p><p><span>&gt; request</span><strong>{request?expired?'expired':'frozen':'not prepared'}</strong></p><p><span>&gt; signature</span><strong>{signed||attempt?'verified':'not imported'}</strong></p><p><span>&gt; submission</span><strong>{attempt?attempt.state:enabled?'requires consent':'locked'}</strong></p></div></section>
      <div className="transfer-security-link"><ShieldCheck size={16}/><Link href="/#security">How signing & verification work <ArrowUpRight size={13}/></Link></div>
    </aside></div>
  </main><TerminalFooter/></div>;
}
