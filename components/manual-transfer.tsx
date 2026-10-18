"use client";
import { useEffect, useState } from "react";
import { formatEther } from "ethers";
import { FILES, MAX_JSON_BYTES, parseJson, publicWallet, validateRequest, verifyResponse, type PublicWallet, type TransferRequest, type SignedResponseV2 } from "@/core/protocol";
import { Button, Card, Input } from "./ui";

const SESSION = "drivekey.manual.v1";
async function read(file: File, expected: string) {
  if (file.name !== expected) throw new Error(`Select ${expected} only. Never select your encrypted vault.`);
  if (file.size > MAX_JSON_BYTES) throw new Error("File exceeds 32 KB.");
  return parseJson(await file.text());
}
function bound(request: unknown, wallet: PublicWallet) {
  const r = validateRequest(request);
  if (r.from.toLowerCase() !== wallet.address.toLowerCase() || r.deviceId !== wallet.deviceId) throw new Error("Request belongs to another wallet.");
  return r;
}
export default function ManualTransfer() {
  const [wallet, setWallet] = useState<PublicWallet | null>(null);
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [signed, setSigned] = useState<SignedResponseV2 | null>(null);
  const [recipient, setRecipient] = useState(""), [amount, setAmount] = useState("");
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION);
      if (saved) { const s = parseJson(saved) as { wallet: unknown; request: unknown }; const w = publicWallet(s.wallet); setWallet(w); setRequest(bound(s.request, w)); setMessage("Pending request restored. Review it again before exporting or importing a signature."); }
    } catch { setMessage("Saved request is invalid or expired. Load your public wallet and prepare a new request. Existing signatures are not revoked."); }
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : "Operation stopped."); } finally { setBusy(false); }
  }
  async function prepare() {
    if (!wallet) throw new Error("Load your public wallet first.");
    const response = await fetch("/api/offline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", wallet, recipient, amount }), signal: AbortSignal.timeout(20000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Preparation failed.");
    const r = bound(result.request, wallet);
    // Persist before offering export, so a reboot cannot silently lose the exact intent.
    localStorage.setItem(SESSION, JSON.stringify({ wallet, request: r }));
    setRequest(r); setSigned(null); setConsent(false);
  }
  return <main className="dk-main"><h1>Manual offline transfer</h1><p>No companion required. Your private key and passphrase stay outside this website.</p><p><a href="/">Back to dashboard</a></p>
    <div className="dk-preview">Mainnet submission locked. This page prepares and verifies only; it cannot send funds.</div>
    {message && <p role="status" className="dk-alert">{message}</p>}
    <Card><h2>1. Load public wallet</h2><label htmlFor="manual-wallet">wallet-public.json</label><Input id="manual-wallet" type="file" accept=".json" disabled={busy || !!request} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if(f) void run(async () => { setWallet(null); setSigned(null); setConsent(false); setWallet(publicWallet(await read(f, FILES.metadata))); }); }}/>
      {wallet && <><p>Compare this full address with your offline console before funding.</p><code className="dk-full-address">{wallet.address}</code></>}
      <p>Never select vault-encrypted.json. Keep an encrypted backup and test recovery before funding.</p>
    </Card>
    <Card><h2>2. Prepare and export</h2><form onSubmit={e => { e.preventDefault(); void run(prepare); }}>
      <label htmlFor="manual-recipient">Recipient address</label><Input id="manual-recipient" value={recipient} onChange={e=>setRecipient(e.target.value)} disabled={busy || !!request} />
      <label htmlFor="manual-amount">ETH amount</label><Input id="manual-amount" value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy || !!request} inputMode="decimal" />
      <Button type="submit" disabled={!wallet || busy || !!request || !recipient || !amount}>Prepare request</Button></form>
      {request && <div className="dk-review"><h3>Review exact transfer</h3><dl><dt>From</dt><dd className="dk-full-address">{request.from}</dd><dt>Recipient</dt><dd className="dk-full-address">{request.to}</dd><dt>Network</dt><dd>Robinhood Chain · 4663 · native ETH</dd><dt>Amount</dt><dd>{formatEther(request.value)} ETH</dd><dt>Maximum fee</dt><dd>{formatEther(BigInt(request.gasLimit)*BigInt(request.maxFeePerGas))} ETH</dd><dt>Maximum total debit</dt><dd>{formatEther(BigInt(request.value)+BigInt(request.gasLimit)*BigInt(request.maxFeePerGas))} ETH</dd><dt>Nonce</dt><dd>{request.nonce}</dd><dt>Deadline (UTC)</dt><dd>{new Date(request.expiresAt).toISOString()}</dd><dt>Fingerprint</dt><dd className="dk-full-address">{request.fingerprint}</dd></dl>
        <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} /> I checked the recipient, network, amount and maximum fee.</label>
        <Button disabled={!consent || busy} onClick={()=>void run(async()=>{ validateRequest(request); const url=URL.createObjectURL(new Blob([JSON.stringify(request,null,2)],{type:"application/json"})); const a=document.createElement("a");a.href=url;a.download=FILES.request;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("Save unsigned-request.json in the USB DriveKey folder. Complete signing within 20 minutes of preparation."); })}>Download unsigned-request.json</Button>
      </div>}
      <p>Save the downloaded file into the USB’s DriveKey folder with the exact filename. Boot offline, run <code>sudo drivekey-offline sign</code>, review all details, then <code>sudo poweroff</code>. Return to this same URL and browser after Windows starts.</p>
    </Card>
    <Card><h2>3. Import and verify response</h2><label htmlFor="manual-response">signed-response.json</label><Input id="manual-response" type="file" accept=".json" disabled={!request || !wallet || !consent || busy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void run(async()=>{setSigned(null);if(!request||!wallet||!consent)throw new Error("Review the pending request first.");const s=verifyResponse(await read(f,FILES.response),request,wallet);setSigned(s);setMessage("Signature verified locally. No transaction was broadcast.");});}}/>
      {signed && <><h3>Verified — not sent</h3><code className="dk-full-address">{signed.transactionHash}</code><p>Real submission requires a separate approval and deployment change. Importing this file never broadcasts it.</p></>}
      <Button disabled>Send locked</Button>
      <Button variant="ghost" disabled={busy} onClick={()=>void run(async()=>{localStorage.removeItem(SESSION);setRequest(null);setSigned(null);setConsent(false);setMessage("Workflow cleared. Any existing signature remains usable; clearing does not cancel it.");})}>Clear manual workflow</Button>
    </Card>
  </main>;
}
