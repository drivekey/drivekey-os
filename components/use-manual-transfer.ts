"use client";
import { useEffect, useRef, useState } from "react";
import { formatEther, parseEther } from "ethers";
import { FILES, MAX_JSON_BYTES, parseJson, publicWallet, validateRequest, verifyResponse, type PublicWallet, type TransferRequest, type SignedResponseV2 } from "@/core/protocol";
import {withTradeJournal} from '@/core/trade-journal';
import {readPublicWalletFile} from '@/core/app-wallet';
import { MANUAL_SESSION, attemptSchema, readManualSession, saveManualSession, type SendAttempt } from "@/core/manual-session";

async function read(file: File, name: string) {
  if (file.name !== name) throw new Error(`Select ${name} only. Never select your encrypted vault.`);
  if (name === FILES.metadata) return readPublicWalletFile(file);
  if (file.size > MAX_JSON_BYTES) throw new Error("File exceeds 32 KB.");
  return parseJson(await file.text());
}
async function api(action: unknown) {
  const response = await fetch("/api/offline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), signal: AbortSignal.timeout(25000) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Network check failed. Nothing is automatically retried.");
  return value;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useManualTransfer() {
  const [wallet, setWallet] = useState<PublicWallet | null>(null);
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [signed, setSigned] = useState<SignedResponseV2 | null>(null);
  const [attempt, setAttempt] = useState<SendAttempt | undefined>();
  const [recipient, setRecipient] = useState(""), [amount, setAmount] = useState("");
  const [consent, setConsent] = useState(false), [sendConsent, setSendConsent] = useState(false);
  const [enabled, setEnabled] = useState(false), [lockSupport, setLockSupport] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [balance, setBalance] = useState<string | null>(null), [now, setNow] = useState<number | null>(null);
  const working = useRef<number|null>(null), generation=useRef(0), mounted=useRef(false);
  const context=JSON.stringify([wallet,request,recipient,amount]), currentContext=useRef(context);currentContext.current=context;
  useEffect(()=>{mounted.current=true;generation.current++;working.current=null;setBusy(false);setConsent(false);setSendConsent(false);return()=>{mounted.current=false;generation.current++;working.current=null;};},[context]);
  function guard(){const id=generation.current,expected=context;return ()=>{if(!mounted.current||generation.current!==id||currentContext.current!==expected)throw Error('Manual transfer context changed. Reconcile any previous attempt.');};}

  useEffect(() => {
    function restore() {
      generation.current++;working.current=null;setBusy(false);
      setSigned(null); setConsent(false); setSendConsent(false); setBalance(null);
      try {
        const saved = localStorage.getItem(MANUAL_SESSION);
        if (!saved) { setRequest(null); setAttempt(undefined); return; }
        const s = readManualSession(saved);
        setWallet(s.wallet); setRequest(s.request); setAttempt(s.attempt);
        setRecipient(s.request.to); setAmount(formatEther(s.request.value));
        setMessage(s.attempt ? "A send attempt was saved. Check its receipt; startup never resends." : "Pending request restored. Review it again before exporting or importing a signature.");
      } catch { setRequest(null); setAttempt(undefined); setMessage("Saved request is invalid. Do not reuse signatures until you reconcile the wallet activity."); }
    }
    restore(); setLockSupport(!!navigator.locks); setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const listener = (event: StorageEvent) => { if (event.key === MANUAL_SESSION || event.key===null) restore(); };
    window.addEventListener("storage", listener);
    let cancelled = false;
    fetch("/api/offline", { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject()).then(v => {
      if (!cancelled) setEnabled(v.chainId === 4663 && v.broadcastEnabled === true);
    }).catch(() => { if (!cancelled) setMessage("Server configuration unavailable. Sending remains locked."); });
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("storage", listener); };
  }, []);

  async function run(fn: (check:()=>void) => Promise<void>) {
    if (working.current!==null) return;
    const id=generation.current,check=guard();working.current = id; setBusy(true); setMessage("");
    try { check();await fn(check); } catch (e) { try{check();setMessage(e instanceof Error ? e.message : "Operation stopped.");}catch{} }
    finally { if(working.current===id){working.current=null;try{check();setBusy(false);}catch{}} }
  }
  function owned() {
    const saved = localStorage.getItem(MANUAL_SESSION);
    if (!saved || !request) throw new Error("Pending request missing. Reload before continuing.");
    const stored = readManualSession(saved);
    if (stored.request.fingerprint !== request.fingerprint) throw new Error("Another tab changed the request. Reload and review again.");
    return stored;
  }
  async function persist(value:Parameters<typeof saveManualSession>[1],expected:string|null,check:()=>void){check();if(!navigator.locks)throw Error('Web Locks required for manual recovery storage.');await navigator.locks.request('drivekey-manual-recovery:'+MANUAL_SESSION,async()=>{check();if(localStorage.getItem(MANUAL_SESSION)!==expected)throw Error('Manual recovery changed in another tab. Reload and reconcile.');saveManualSession(localStorage,value);});check();return JSON.stringify(value);}
  async function prepare() {
    const check=guard();check();
    if (!wallet) throw new Error("Load your public wallet first.");
    if (localStorage.getItem(MANUAL_SESSION)) throw new Error("A saved workflow exists. Clear or finish it before preparing another.");
    const result = await api({ action: "prepare", wallet, recipient, amount });
    check();
    const r = validateRequest(result.request);
    if (r.from.toLowerCase() !== wallet.address.toLowerCase() || r.deviceId !== wallet.deviceId || r.to.toLowerCase() !== recipient.toLowerCase()) throw new Error("Prepared request does not match the selected wallet.");
    // Independently bind what the user typed, not only server-provided metadata.
    if (BigInt(r.value) !== parseEther(amount)) throw new Error("Prepared amount differs from your input.");
    await persist({ wallet, request:r },null,check);
    setRequest(r); setSigned(null); setAttempt(undefined); setConsent(false); setSendConsent(false);
    setEnabled(result.broadcastEnabled === true);
  }
  async function send() {
    const check=guard();check();
    if (!request || !wallet || !signed || !consent || !sendConsent || !enabled || !navigator.locks) throw new Error("Review and explicitly authorize this exact transfer first.");
    await withTradeJournal('robinhood:'+request.from.toLowerCase(),signed.transactionHash,request.fingerprint,async journal=>{
      check();const prior=await journal.read();check();if(prior)throw Error('This exact transaction already has a durable attempt. Reconcile it; never resend.');
      const stored = owned();let expected=localStorage.getItem(MANUAL_SESSION);
      if (stored.attempt) { setAttempt(stored.attempt); throw new Error("This request already has a send attempt. Check its receipt; do not resend."); }
      const verified = verifyResponse(signed, request, wallet);
      const checked = await api({ action: "preflight", wallet, request, response: verified });
      check();if (checked.hash !== verified.transactionHash || checked.state !== "ready" || checked.broadcastEnabled !== true) throw new Error("Preflight did not authorize submission. Sending remains locked.");
      if (owned().attempt) throw new Error("A send attempt was recorded elsewhere. Check its receipt.");
      await journal.write({hash:verified.transactionHash,fingerprint:request.fingerprint,state:'unknown'});
      check();const committed=await journal.read();check();if(committed?.hash!==verified.transactionHash)throw Error('Durable intent unavailable.');
      const marker: SendAttempt = { hash: verified.transactionHash, state: "submitting" };
      // Persist before network submission, so crashes/timeouts cannot cause automatic retries.
      expected=await persist({wallet,request,attempt:marker},expected,check); setAttempt(marker); setSendConsent(false);
      try {
        check();verifyResponse(verified,request,wallet);
        const result = attemptSchema.parse(await api({ action: "broadcast", wallet, request, response: verified, consent: true }).then(({ hash, state }) => ({ hash, state })));
        check();if (result.hash !== marker.hash) throw new Error("Unexpected submission hash.");
        if(['submitted','confirmed','reverted'].includes(result.state))await journal.write({hash:result.hash,fingerprint:request.fingerprint,state:result.state==='reverted'?'failed':result.state==='confirmed'?'confirmed':'submitted'});
        check();expected=await persist({wallet,request,attempt:result},expected,check); setAttempt(result);
        setMessage(result.state === "submitted" ? "Submitted. Check the receipt for confirmation." : "Submission is not confirmed. Track this exact hash; do not create a replacement payment.");
      } catch {
        check();const uncertain: SendAttempt = { ...marker, state: "unknown" }; setAttempt(uncertain);
        try { await persist({wallet,request,attempt:uncertain},expected,check); } catch { /* original submitting marker remains */ }
        setMessage("Submission outcome is uncertain. Check this exact hash. Do not resend or create a replacement payment.");
      }
    });
  }
  async function receipt() {
    const check=guard();check();
    if (!wallet || !request || !attempt) return;
    const expected=localStorage.getItem(MANUAL_SESSION);const saved=owned();if(saved.attempt?.hash!==attempt.hash||saved.attempt?.state!==attempt.state)throw Error('Manual recovery changed. Reload and reconcile.');
    const result = await api({ action: "status", hash: attempt.hash, request });
    check();const next = attemptSchema.parse({ hash: result.hash, state: result.state });
    if (next.hash !== attempt.hash) throw new Error("Receipt hash mismatch.");
    await withTradeJournal('robinhood:'+request.from.toLowerCase(),attempt.hash,request.fingerprint,async journal=>{check();if(['confirmed','reverted','pending','submitted'].includes(next.state)){await journal.write({hash:next.hash,fingerprint:request.fingerprint,state:next.state==='reverted'?'failed':next.state==='confirmed'?'confirmed':'submitted'});check();}});
    check();await persist({wallet,request,attempt:next},expected,check); setAttempt(next);
    setMessage(next.state === "not-seen" ? "Not seen by this RPC. This is not cancellation; no automatic resend is allowed." : `Transaction ${next.state}${result.finality ? ' · '+result.finality : ''}.`);
  }
  async function clearSession(){const check=guard();check();const expected=localStorage.getItem(MANUAL_SESSION);if(expected){const saved=readManualSession(expected);if(saved.request.fingerprint!==request?.fingerprint||saved.attempt?.hash!==attempt?.hash||saved.attempt?.state!==attempt?.state)throw Error('Manual recovery changed. Reload and reconcile.');}if(!navigator.locks)throw Error('Web Locks required.');await navigator.locks.request('drivekey-manual-recovery:'+MANUAL_SESSION,async()=>{check();if(localStorage.getItem(MANUAL_SESSION)!==expected)throw Error('Manual recovery changed. Reload and reconcile.');localStorage.removeItem(MANUAL_SESSION);});check();}
  const expired = !!request && now !== null && now >= Date.parse(request.expiresAt);
  const remaining = request && now !== null ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - now) / 60000)) : null;
  const complete = attempt?.state === "confirmed" || attempt?.state === "reverted";

  return {wallet,setWallet,request,setRequest,signed,setSigned,attempt,setAttempt,recipient,setRecipient,amount,setAmount,consent,setConsent,sendConsent,setSendConsent,enabled,lockSupport,busy,message,setMessage,balance,setBalance,now,expired,remaining,complete,run,owned,prepare,send,receipt,clearSession};
}
export {read as readTransferFile,api as transferApi,download as downloadTransfer};

