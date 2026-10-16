import {withServiceTelemetry,tagServiceResponse,operationalReason} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {serverSolanaConnection} from '@/core/solana-rpc';
import { NextRequest, NextResponse } from "next/server";

import {PAYMENT_PATHS,paymentExecutionEnabled,LIVE_RELEASE_BLOCK} from '@/core/live-release-policy';
import { multiAction } from "@/core/multi-service";
import { nonceSetupAction } from "@/core/nonce-setup-service";
import { sameRequestOrigin } from "@/core/http-origin";
import { parseJson, type Rpc } from "@/core/protocol";
import { ZodError } from "zod";
import {boundedRpcCall} from '@/core/rpc-proxy';
import {WalletSubmissionLedger} from '@/core/wallet-submission-ledger';
import {NonceSetupLedger} from '@/core/nonce-setup-ledger';
export const runtime = "nodejs";
const enabled=()=>PAYMENT_PATHS['robinhood-weth'].enabled||PAYMENT_PATHS['robinhood-usdg'].enabled;
const allowed = new Set(["eth_chainId", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getBalance", "eth_getTransactionCount", "eth_estimateGas", "eth_getBlockByNumber", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
const rpc: Rpc = async (method, params = []) => {
  if (!allowed.has(method)&&!(enabled()&&method==="eth_sendRawTransaction")) throw new Error("RPC method disabled.");
  return boundedRpcCall(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",method,params);
};
const sol=()=>serverSolanaConnection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
const limits = new Map<string, { n: number; until: number }>();
async function handlePost(request: NextRequest) {
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!sameRequestOrigin(request.headers.get("origin"), request.headers.get("host"), request.nextUrl.protocol)) return reply({ error: "Cross-origin action refused." }, 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply({ error: "Expected JSON." }, 415);
  const now = Date.now(), ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  for (const [key, v] of limits) if (v.until < now) limits.delete(key);
  if (limits.size > 10_000) return reply({error:"Service busy."},429);
  const limit = limits.get(ip) || {n:0,until:now+60_000}; limits.set(ip,limit);
  if (++limit.n > 40) return reply({error:"Rate limited. Retry shortly."},429);
  try {
    const reader = request.body?.getReader(); if (!reader) throw new Error("Missing body.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const {value,done} = await reader.read(); if(done)break; size += value.length; if(size > 32768){await reader.cancel();throw new Error("File too large.");} chunks.push(value); }
    const buffer = new Uint8Array(size); let offset=0; for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
    const input = parseJson(new TextDecoder().decode(buffer));
    if(input&&typeof input==='object'&&'action' in input){
      if(input.action==='broadcast'&&!paymentExecutionEnabled((input as {request?:unknown}).request))return reply(LIVE_RELEASE_BLOCK,503);
      if(input.action==='nonce-submit'&&!PAYMENT_PATHS['solana-nonce-setup'].enabled)return reply(LIVE_RELEASE_BLOCK,503);
    }
 const sharedLimit=await serviceRateLimitHttp('assets',reply);if(sharedLimit)return sharedLimit;
    if (input && typeof input === "object" && "action" in input && typeof input.action === "string" && input.action.startsWith("nonce-")){
      let setupStore:NonceSetupLedger|undefined;
      if(input.action==='nonce-submit'||input.action==='nonce-status'){
        const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;
        if(url&&scope)setupStore=new NonceSetupLedger(url,scope);
        else if(input.action==='nonce-submit')throw Error('Durable setup journal is not configured.');
      }
      return reply(await nonceSetupAction(input,sol(),PAYMENT_PATHS['solana-nonce-setup'].enabled,setupStore));
    }
    let store:WalletSubmissionLedger|undefined;
    if(input&&typeof input==='object'&&'action' in input&&input.action==='broadcast'){
      const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;
      if(!url||!scope)throw Error('Durable wallet submission storage is not configured.');
      store=new WalletSubmissionLedger(url,scope);
    }
    return reply(await multiAction(input,rpc,sol(),paymentExecutionEnabled((input as {request?:unknown})?.request),store));
  } catch(error) { return tagServiceResponse(reply({error:error instanceof ZodError?"Malformed public asset action.":error instanceof Error?error.message:"Action stopped."},400),operationalReason(error)); }
}


export const POST=withServiceTelemetry('assets',handlePost);
