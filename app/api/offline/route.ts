import {withServiceTelemetry,tagServiceResponse,operationalReason} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {PAYMENT_PATHS,LIVE_RELEASE_BLOCK} from '@/core/live-release-policy';
import { walletAction } from "@/core/service";
import { MAX_JSON_BYTES, parseJson, type Rpc } from "@/core/protocol";
import { sameRequestOrigin } from "@/core/http-origin";
import {boundedRpcCall} from '@/core/rpc-proxy';
import {WalletSubmissionLedger} from '@/core/wallet-submission-ledger';

export const runtime = "nodejs";
const READ_METHODS = new Set(["eth_call", "eth_chainId", "eth_getBalance", "eth_getTransactionCount", "eth_estimateGas", "eth_getCode", "eth_getBlockByNumber", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt"]);
const limits = new Map<string, { count: number; until: number }>();
const enabled = () => PAYMENT_PATHS['robinhood-native'].enabled;

const rpc: Rpc = async (method, params = []) => {
  if (!READ_METHODS.has(method) && !(enabled() && method === "eth_sendRawTransaction")) throw new Error("RPC method is disabled.");
  return boundedRpcCall(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",method,params);
};

export async function GET() { return NextResponse.json({ version: 2, chainId: 4663, broadcastEnabled: enabled(), safety: "trusted-clean-pc-prototype" }, { headers: { "Cache-Control": "no-store" } }); }

async function handlePost(request: NextRequest) {
  const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (!sameRequestOrigin(origin, request.headers.get("host"), request.nextUrl.protocol)) return reply({ error: "Cross-origin wallet actions are not allowed." }, 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply({ error: "Expected JSON." }, 415);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  if (limits.size > 10_000) { for (const [key, value] of limits) if (value.until < now) limits.delete(key); if (limits.size > 10_000) return reply({ error: "Service busy. Retry shortly." }, 429); }
  let limit = limits.get(ip); if (!limit || now >= limit.until) { limit = { count: 0, until: now + 60_000 }; limits.set(ip, limit); }
  if (++limit.count > 90) return reply({ error: "Request limit reached. Retry in a minute." }, 429);
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) return reply({ error: "Request too large." }, 413);
    const reader = request.body?.getReader(); if (!reader) throw new Error("Missing request.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_JSON_BYTES) { await reader.cancel(); return reply({ error: "Request too large." }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const input=parseJson(new TextDecoder().decode(bytes));
    if(input&&typeof input==='object'&&'action' in input&&input.action==='broadcast'&&!enabled())return reply(LIVE_RELEASE_BLOCK,503);
 const sharedLimit=await serviceRateLimitHttp('offline',reply);if(sharedLimit)return sharedLimit;
    let store:WalletSubmissionLedger|undefined;
    if(input&&typeof input==='object'&&'action' in input&&input.action==='broadcast'&&enabled()){
      const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;
      if(!url||!scope)throw Error('Durable wallet submission storage is not configured.');
      store=new WalletSubmissionLedger(url,scope);
    }
    return reply(await walletAction(input, rpc, enabled(),store));
  } catch (error) { return tagServiceResponse(reply({ error: error instanceof z.ZodError ? "Malformed wallet action." : error instanceof Error ? error.message : "Wallet action stopped." }, 400),operationalReason(error)); }
}

export const POST=withServiceTelemetry('offline',handlePost);

