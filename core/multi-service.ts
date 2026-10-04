import {solanaEvidence,evmEvidence} from './transaction-evidence';
import { z } from "zod";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ERC20, multiPublicSchema, multiRequestSchema, multiResponseSchema, verifyMultiResponse, type MultiRequest } from "./multi-protocol";
import { inspectErc20, inspectSpl, prepareErc20, prepareSol, preflightMulti, checkSolanaCluster } from "./multi-online";
import { assetIdentity } from "./asset-identity";
import { Transaction } from "ethers";
import type { Rpc } from "./protocol";
import {robinhoodTokenIdentity} from './robinhood-proxy-identity';
const wallet = multiPublicSchema;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), wallet, network: z.enum(["robinhood", "solana"]), token: z.string().max(64) }).strict(),
  z.object({ action: z.literal("prepare"), wallet, network: z.enum(["robinhood", "solana"]), token: z.string().max(64), recipient: z.string().max(64), amount: z.string().max(78), nonceAccount: z.string().max(44) }).strict(),
  z.object({ action: z.literal("preflight"), wallet, request: multiRequestSchema, response: multiResponseSchema }).strict(),
  z.object({ action: z.literal("broadcast"), wallet, request: multiRequestSchema, response: multiResponseSchema, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("status"), wallet, request: multiRequestSchema, response: multiResponseSchema }).strict(),
]);
export async function multiStatus(r: MultiRequest, hash: string, rpc: Rpc, sol: Connection, raw: string) {
  if (r.network === "solana") {
    await checkSolanaCluster(sol);
    const result=await solanaEvidence(hash,raw,sol);
    return {...result,state:result.state==='unknown'?'not-seen':result.state==='submitted'?'pending':result.state};
  }
  if (await rpc("eth_chainId") !== "0x1237") throw new Error("Wrong network.");
  const evidence=await evmEvidence(hash,raw,rpc);
  if(evidence.state!=='confirmed')return {...evidence,state:evidence.state==='unknown'?'not-seen':evidence.state==='submitted'?'pending':evidence.state};
  const receipt = await rpc("eth_getTransactionReceipt", [hash]) as {transactionHash:string;status:string;blockHash:string;blockNumber:string;logs?:{address:string;topics:string[];data:string}[]} | null;
  if (!receipt) return { state: await rpc("eth_getTransactionByHash", [hash]) ? "pending" : "not-seen", hash };
  if(receipt.blockHash!==evidence.evidenceBlockHash||receipt.blockNumber!==evidence.evidenceBlockNumber||receipt.status!=='0x1')throw Error('Receipt changed during evidence verification. Recheck the exact hash.');
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !["0x0", "0x1"].includes(receipt.status)) throw new Error("Invalid receipt.");
  const actual=await rpc("eth_getTransactionByHash",[hash]) as {hash:string;from:string;to:string;input:string;value:string;nonce:string;blockHash:string;blockNumber:string}|null;
  if(!actual)return {state:"pending",hash,deliveryEvidence:"Waiting for matching transaction evidence."};
  const expected=Transaction.from(raw);
  if(actual.hash?.toLowerCase()!==hash.toLowerCase()||actual.from?.toLowerCase()!==r.from.toLowerCase()||actual.to?.toLowerCase()!==r.token.toLowerCase()||actual.input?.toLowerCase()!==expected.data.toLowerCase()||BigInt(actual.value)!==expected.value||BigInt(actual.nonce)!==BigInt(expected.nonce)||!/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)||actual.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase()||actual.blockNumber!==receipt.blockNumber)throw Error("Receipt transaction does not match the approved token transfer.");
  const matches=(receipt.logs??[]).filter(log=>{try{if(log.address.toLowerCase()!==r.token.toLowerCase())return false;const event=ERC20.parseLog(log);return event?.name==="Transfer"&&event.args[0].toLowerCase()===r.from.toLowerCase()&&event.args[1].toLowerCase()===r.recipient.toLowerCase()&&event.args[2].toString()===r.amount;}catch{return false;}});
  return { finality:'finalized', state: matches.length===1 ? "confirmed" : "unknown", hash, deliveryEvidence: matches.length===1 ? "Matching transaction, receipt and Transfer event. Events alone do not prove actual balance delivery for arbitrary tokens." : "No unique matching Transfer event. Exact token delivery is uncertain; do not resend." };
}
export async function multiAction(input: unknown, rpc: Rpc, sol: Connection, broadcastEnabled=false) {
  const a = schema.parse(input);
  if (a.action === "inspect") {
    const address = a.network === "robinhood" ? a.wallet.evmAddress : a.wallet.solanaAddress;
    if (a.token === "native") {
      let quantity: string;
      if (a.network === "solana") { await checkSolanaCluster(sol); quantity = String(await sol.getBalance(new PublicKey(address), "confirmed")); }
      else { if (await rpc("eth_chainId") !== "0x1237") throw new Error("Wrong network."); const raw = await rpc("eth_getBalance", [address, "latest"]); if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(raw)) throw new Error("Invalid balance."); quantity = BigInt(raw).toString(); }
      return { holding: { id: assetIdentity(a.network, "native"), network: a.network, address: "native", symbol: a.network === "solana" ? "SOL" : "ETH", name: a.network === "solana" ? "Solana" : "Ether", quantity, decimals: a.network === "solana" ? 9 : 18, supported: true, updatedAt: new Date().toISOString(), price: null }, broadcastEnabled: false };
    }
    if (a.network === "robinhood") {
      const token = await inspectErc20(rpc, a.token, address);
      const pin=robinhoodTokenIdentity(token.address),supported=!!pin&&token.codeHash===pin.proxyCodeHash&&token.decimals===pin.decimals;
      return { holding: { id: token.id, network: a.network, address: token.address, symbol: token.symbol, name: token.name, quantity: token.balance, decimals: token.decimals, supported, warning: supported?`Canonical ${pin!.symbol} requires ${pin!.signer} v6 offline approval and fresh implementation checks.`: 'This ERC-20 has not passed token acceptance. Transfers are unsupported.', updatedAt: token.updatedAt, price: null }, broadcastEnabled: false };
    }
    const token = await inspectSpl(sol, a.token, address);
    if (!("decimals" in token)) return { unsupported: token.reason, address: token.address, broadcastEnabled: false };
    return { holding: { id: assetIdentity(a.network, a.token), network: a.network, address: a.token, symbol: token.symbol, name: token.name, quantity: token.balance, decimals: token.decimals, supported: token.supported, warning: token.reason, updatedAt: new Date().toISOString(), price: null }, broadcastEnabled: false };
  }
  if (a.action === "prepare") {
    if (a.network === "robinhood" && a.token === "native") throw new Error("Use the existing Offline transfer page for native ETH.");
    if(a.network==='robinhood'&&!robinhoodTokenIdentity(a.token))throw Error('Unsupported Robinhood token. Only reviewed canonical token identities have a v6 preparation path.');
    const request = a.network === "robinhood" ? await prepareErc20(a.wallet, a.token, a.recipient, a.amount, rpc) : await prepareSol(a.wallet, a.token, a.recipient, a.amount, a.nonceAccount, sol);
    return { request, broadcastEnabled: false };
  }
  const response = verifyMultiResponse(a.response, a.request, a.wallet, Date.now(), false);
  if (a.action === "status") return multiStatus(a.request, response.transactionHash, rpc, sol, response.rawSignedTransaction);
  if(a.action==="broadcast"){
    const existing=await multiStatus(a.request,response.transactionHash,rpc,sol,response.rawSignedTransaction);
    if(existing.state!=="not-seen")return {...existing,broadcastEnabled};
    if(!broadcastEnabled)return {state:"verified-only",hash:response.transactionHash,broadcastEnabled:false,message:"Multi-asset submission is locked. No funds sent."};
  }
  await preflightMulti(a.request, rpc, sol);
  if(a.request.network==="solana"){
    const simulation=await sol.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(response.rawSignedTransaction,"base64")),{sigVerify:true,replaceRecentBlockhash:false,commitment:"confirmed"});
    if(simulation.value.err)throw new Error("Signed Solana transaction simulation failed. Nothing submitted.");
  }
  // Fee/account RPCs and simulation may finish after approval expires.
  verifyMultiResponse(a.response,a.request,a.wallet);
  if(a.action==="preflight")return {state:"ready",hash:response.transactionHash,broadcastEnabled,message:broadcastEnabled?"Preflight passed. Separate explicit submission consent required.":"Exact response and preflight verified. Submission remains locked pending acceptance; no funds sent."};
  try{
    const hash=a.request.network==="robinhood"?await rpc("eth_sendRawTransaction",[response.rawSignedTransaction]):await sol.sendRawTransaction(Buffer.from(response.rawSignedTransaction,"base64"),{skipPreflight:false,maxRetries:0,preflightCommitment:"confirmed"});
    if(hash!==response.transactionHash)throw Error("Unexpected submission hash.");
    return {state:"submitted",hash:response.transactionHash,broadcastEnabled};
  }catch{return {state:"unknown",hash:response.transactionHash,broadcastEnabled,message:"Submission outcome unknown. Reconcile this exact hash; do not retry or create a replacement."};}
}
