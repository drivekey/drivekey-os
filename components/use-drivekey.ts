"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {withTradeJournal} from '@/core/trade-journal';
import { z } from "zod";
import { metadataSchema, publicWallet, requestSchema, responseSchema, verifyResponse, type PublicWallet, type TransferRequest } from "@/core/protocol";

const BRIDGE = "http://127.0.0.1:47831";
const statusSchema = z.object({ version: z.literal(2), nativeReady: z.boolean(), phase: z.enum(["idle","awaiting-removal","awaiting-reconnect","awaiting-offline","paused","awaiting-return-removal","awaiting-return","signed","error"]), message: z.string().max(1200), connected: z.boolean(), volumes: z.array(metadataSchema).max(26), wallet: metadataSchema.nullable(), request: requestSchema.nullable(), response: responseSchema.nullable() }).strict();
type CompanionStatus = z.infer<typeof statusSchema>;
type HistoryItem = { request?:TransferRequest; hash: string; state: string; to: string; amount: string; at: string };
const historySchema = z.array(z.object({ request:requestSchema.optional(), hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/), state:z.string().max(40), to:z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount:z.string().max(24), at:z.string().datetime() })).max(20);

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed.");
  return value as T;
}
const action = <T,>(value: unknown) => json<T>("/api/offline", { method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify(value) });

export function useDriveKey() {
  const [token,setToken] = useState<string|null>(null), [status,setStatus] = useState<CompanionStatus|null>(null);
  const [wallet,setWallet] = useState<PublicWallet|null>(null), [draft,setDraft] = useState<TransferRequest|null>(null);
  const [balance,setBalance] = useState<string|null>(null), [network,setNetwork] = useState("Checking network…"), [broadcastEnabled,setBroadcastEnabled] = useState(false);
  const [error,setError] = useState(""), [busy,setBusy] = useState(false), [history,setHistory] = useState<HistoryItem[]>([]), [loaded,setLoaded] = useState(false);
  const consent = useRef<string|null>(null), attempted = useRef(new Set<string>());
  const walletAddress = useRef<string|null>(null);

  useEffect(()=>{
    try {
      setToken(sessionStorage.getItem("drivekey.v2.pair"));
      const saved=localStorage.getItem("drivekey.v2.public"); if(saved)setWallet(publicWallet(JSON.parse(saved)));
      const list=localStorage.getItem("drivekey.v2.activity");
      let restored:HistoryItem[]=list?historySchema.parse(JSON.parse(list)):[];
      const last=localStorage.getItem("drivekey.v2.last-attempt");
      if(last){const item=historySchema.parse([JSON.parse(last)])[0];attempted.current.add(item.hash);if(!restored.some(v=>v.hash===item.hash))restored=[{...item,state:"unknown"},...restored].slice(0,20);}
      restored.forEach(item=>attempted.current.add(item.hash));setHistory(restored);
    } catch { setError("Saved public session was invalid. Pair the companion again."); }
    setLoaded(true);
    json<{broadcastEnabled:boolean}>("/api/offline").then(v=>{setBroadcastEnabled(v.broadcastEnabled);setNetwork("Robinhood mainnet · 4663");}).catch(()=>setNetwork("Network configuration unavailable"));
  },[]);

  useEffect(()=>{if(loaded)try{localStorage.setItem("drivekey.v2.activity",JSON.stringify(history));}catch{setError("Browser storage is unavailable. Keep this page open and record transaction hashes.");}},[history,loaded]);

  const bridge = useCallback(async (path:string, value?:unknown) => {
    if(!token)throw new Error("Pair the Windows companion first.");
    const result=await json<unknown>(`${BRIDGE}/v1/${path}`,{method:value===undefined?"GET":"POST",headers:{Authorization:`Bearer ${token}`, ...(value===undefined?{}:{"Content-Type":"application/json"})},...(value===undefined?{}:{body:JSON.stringify(value)})});
    const next=statusSchema.parse(result);setStatus(next);return next;
  },[token]);

  useEffect(()=>{
    if(!token)return;
    let stopped=false;
    const poll=async()=>{
      try {
        const next=await json<unknown>(`${BRIDGE}/v1/status`,{headers:{Authorization:`Bearer ${token}`}});
        if(stopped)return;const parsed=statusSchema.parse(next);setStatus(parsed);
        if(parsed.wallet){setWallet(current=>current?.address===parsed.wallet!.address&&current.deviceId===parsed.wallet!.deviceId?current:parsed.wallet);try{localStorage.setItem("drivekey.v2.public",JSON.stringify(parsed.wallet));}catch{/* Public cache is optional. */}}
      } catch { if(!stopped){setStatus(null);setError("Companion unavailable or pairing expired. Start it, allow local-network access, and pair again. No transaction is being triggered.");} }
    };
    void poll();const interval=setInterval(poll,1500);return()=>{stopped=true;clearInterval(interval);};
  },[token]);

  const refreshBalance=useCallback(async()=>{
    if(!wallet)return;
    const address=wallet.address;walletAddress.current=address;
    try{const result=await action<{wei:string;broadcastEnabled:boolean}>({action:"balance",wallet});if(walletAddress.current!==address)return;setBalance(result.wei);setBroadcastEnabled(result.broadcastEnabled);setNetwork("Mainnet RPC connected");}
    catch{if(walletAddress.current===address){setBalance(null);setNetwork("Mainnet RPC unavailable");}}
  },[wallet]);
  useEffect(()=>{void refreshBalance();const timer=setInterval(()=>void refreshBalance(),60_000);return()=>clearInterval(timer);},[refreshBalance]);

  const record=useCallback((item:HistoryItem)=>setHistory(previous=>[item,...previous.filter(v=>v.hash!==item.hash)].slice(0,20)),[]);
  async function submit(){
    const request=status?.request,response=status?.response;
    if(!status?.nativeReady || status.phase!=="signed" || !request || !response || !wallet || attempted.current.has(response.transactionHash))return;
    attempted.current.add(response.transactionHash); consent.current=null;
    const item={hash:response.transactionHash,state:"checking",to:request.to,amount:request.value,at:new Date().toISOString(),request};
    record(item);setBusy(true);
    try {
      await withTradeJournal("robinhood:"+request.from.toLowerCase(),response.transactionHash,request.fingerprint,async journal=>{
        if(await journal.read())throw Error("This transaction already has a durable attempt. Check status; never resend.");
        verifyResponse(response,request,wallet);
        const checked=await action<{hash:string;state:string;broadcastEnabled:boolean}>({action:"preflight",wallet,request,response});
        if(checked.hash!==response.transactionHash||checked.state!=="ready"||!checked.broadcastEnabled)throw Error("Preflight did not enable submission.");
        await journal.write({hash:response.transactionHash,fingerprint:request.fingerprint,state:"unknown"});
        verifyResponse(response,request,wallet);
        // Persist the intended hash before any request that could submit its signed bytes.
        localStorage.setItem("drivekey.v2.last-attempt",JSON.stringify(item));
        const result=await action<{hash:string;state:string;message?:string}>({action:"broadcast",wallet,request,response,consent:true});
        if(result.hash!==response.transactionHash)throw Error("Unexpected submission hash.");
        if(result.state==="submitted")await journal.write({hash:result.hash,fingerprint:request.fingerprint,state:"submitted"});
        record({...item,state:result.state});if(result.message)setError(result.message);else setError("");
      });
      } catch(error){record({...item,state:"unknown"});setError(error instanceof Error?error.message:"Submission outcome is uncertain. Track the exact hash.");}
      finally{setBusy(false);}
  }

  const checkReceipt=useCallback(async(hash:string)=>{
    try { const request=history.find(v=>v.hash===hash)?.request;if(!request)throw Error("Restore the public request for evidence verification.");const result=await action<{state:string}>({action:"status",hash,request});if(["confirmed","reverted"].includes(result.state))await withTradeJournal("robinhood:"+request.from.toLowerCase(),hash,request.fingerprint,store=>store.write({hash,fingerprint:request.fingerprint,state:result.state==="confirmed"?"confirmed":"failed"}));setHistory(items=>items.map(v=>v.hash===hash?{...v,state:result.state}:v)); }
    catch { setError("Receipt check unavailable. Keep the transaction hash and try again; do not create a duplicate payment."); }
  },[history]);
  useEffect(()=>{
    const pending=history.filter(v=>["submitted","pending","unknown","not-seen","checking"].includes(v.state));if(!pending.length)return;
    const timer=setInterval(()=>void checkReceipt(pending[0].hash),5000);return()=>clearInterval(timer);
  },[history,checkReceipt]);

  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Operation stopped.");}finally{setBusy(false);}};
  return {submit,wallet,status,draft,request:status?.request??draft,balance,network,broadcastEnabled,error,busy,history,refreshBalance,checkReceipt,setError,
    pair:(code:string)=>run(async()=>{const result=await json<{token:string}>(`${BRIDGE}/v1/pair`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});sessionStorage.setItem("drivekey.v2.pair",result.token);setToken(result.token);}),
    prepare:(recipient:string,amount:string)=>run(async()=>{if(!wallet||!status?.connected||!status.nativeReady)throw new Error("Connect one provisioned USB through the companion first.");consent.current=null;const result=await action<{request:TransferRequest}>({action:"prepare",wallet,recipient,amount});setDraft(requestSchema.parse(result.request));}),
    arm:()=>run(async()=>{if(!draft)throw new Error("Prepare and review a transaction first.");await bridge("prepare",{request:draft,consent:true});consent.current=draft.fingerprint;setDraft(null);}),
    resume:()=>run(async()=>{if(!status?.request)throw new Error("No request to resume.");const next=await bridge("resume",{consent:true});consent.current=next.request!.fingerprint;}),
    cancel:()=>run(async()=>{consent.current=null;setDraft(null);if(status?.request)await bridge("cancel",{});}),
    select:(deviceId:string)=>run(async()=>{await bridge("select",{deviceId});}),
    disconnect:()=>{consent.current=null;sessionStorage.removeItem("drivekey.v2.pair");setToken(null);setStatus(null);setError("Browser disconnected. Existing signatures are not revoked.");},
  };
}
