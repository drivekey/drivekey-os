import {evmEvidence} from './transaction-evidence';
import {Transaction,toQuantity,sha256} from 'ethers';
import type {WalletSubmissionClaim,WalletSubmissionStore} from './wallet-submission-ledger';
import { z } from "zod";
import { CHAIN_ID, metadataSchema, prepareRequest, preflight, requestSchema, responseSchema, verifyResponse, validateRequest, type Rpc } from "./protocol";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("balance"), wallet: metadataSchema }).strict(),
  z.object({ action: z.literal("prepare"), wallet: metadataSchema, recipient: z.string().max(42), amount: z.string().max(40) }).strict(),
  z.object({ action: z.literal("preflight"), wallet: metadataSchema, request: requestSchema, response: responseSchema }).strict(),
  z.object({ action: z.literal("broadcast"), wallet: metadataSchema, request: requestSchema, response: responseSchema, consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("status"), request: requestSchema, hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict(),
]);

async function exactPreflight(request:Parameters<typeof preflight>[0],rpc:Rpc){
 await preflight(request,rpc);
 const tx=Transaction.from(request.unsignedTransaction);
 const result=await rpc('eth_call',[{from:request.from,to:tx.to,data:tx.data,value:toQuantity(tx.value),gas:toQuantity(tx.gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!)},'pending']);
 if(result!=='0x')throw Error('Exact native transfer simulation failed.');
}
export async function walletAction(input: unknown, rpc: Rpc, broadcastEnabled = false,store?:WalletSubmissionStore): Promise<unknown> {
  const action = actionSchema.parse(input);
  if (BigInt(String(await rpc("eth_chainId"))) !== BigInt(CHAIN_ID)) throw new Error("RPC returned the wrong network.");
  if (action.action === "balance") {
    const wei = await rpc("eth_getBalance", [action.wallet.address, "latest"]);
    if (typeof wei !== "string" || !/^0x[0-9a-fA-F]{1,32}$/.test(wei)) throw new Error("Invalid balance response.");
    return { wei: BigInt(wei).toString(), chainId: CHAIN_ID, broadcastEnabled };
  }
  if (action.action === "prepare") return { request: await prepareRequest(action.wallet, action.recipient, action.amount, rpc), broadcastEnabled };
  if (action.action === "status") {
    const r=validateRequest(action.request,Date.now(),false);
    const result=await evmEvidence(action.hash,r.unsignedTransaction,rpc,r.from);
    return {...result,state:result.state==='failed'?'reverted':result.state==='unknown'?'not-seen':result.state==='submitted'?'pending':result.state};
  }
  const response = verifyResponse(action.response, action.request, action.wallet, Date.now(), false);
  const hash = response.transactionHash;
  if (action.action === "preflight") {
    await exactPreflight(action.request, rpc);
    verifyResponse(action.response, action.request, action.wallet);
    return { hash, state: "ready", broadcastEnabled };
  }
  const known=await rpc('eth_getTransactionByHash',[hash]);
  if(known){
    const evidence=await evmEvidence(hash,response.rawSignedTransaction,(method,params)=>method==='eth_getTransactionByHash'?Promise.resolve(known):rpc(method,params));
    return {...evidence,state:evidence.state==='failed'?'reverted':evidence.state,alreadyKnown:true};
  }
  if (!broadcastEnabled) return { hash, state: "verified-only", message: "Offline signature verified. Mainnet submission is disabled in this preview until the physical workflow is tested and explicitly enabled." };
  if(!store)throw Error('Durable wallet submission storage is required before broadcasting.');
  const tx=Transaction.from(response.rawSignedTransaction);
  const record:WalletSubmissionClaim={version:1,kind:'evm',purpose:'transfer',protocolVersion:2,chainId:CHAIN_ID,from:tx.from!.toLowerCase(),nonce:tx.nonce,hash:hash.toLowerCase(),fingerprint:action.request.fingerprint.toLowerCase(),signedBytesDigest:sha256(response.rawSignedTransaction),expiresAt:action.request.expiresAt};
  const identity={family:'evm' as const,chainId:CHAIN_ID,hash:record.hash};
  const matches=(candidate:WalletSubmissionClaim)=>Object.keys(candidate).length===Object.keys(record).length&&Object.entries(record).every(([key,value])=>value===(candidate as Record<string,unknown>)[key]);
  const previous=await store.read(identity);
  if(previous){
    if(!matches(previous))throw Error('Submission journal identity differs. Reconcile before continuing.');
    return {hash,state:'unknown',canResubmit:false,message:'Submission was already claimed. Check this exact hash; no automatic resend.'};
  }
  await exactPreflight(action.request, rpc);
  // RPC checks can consume the remaining approval lifetime.
  verifyResponse(action.response, action.request, action.wallet);
  if(!await store.claim(record))return {hash,state:'unknown',canResubmit:false,message:'This transaction or wallet nonce was already claimed. Reconcile saved transactions; do not resend.'};
  const persisted=await store.read(identity);
  if(!persisted||!matches(persisted))throw Error('Submission intent could not be verified in durable storage.');
  // A storage round trip can consume the remaining signed lifetime too.
  verifyResponse(action.response, action.request, action.wallet);
  try {
    const result = await rpc("eth_sendRawTransaction", [response.rawSignedTransaction]);
    if (typeof result !== "string" || result.toLowerCase() !== hash.toLowerCase()) throw new Error("Unexpected submission response.");
    return { hash, state: "submitted", alreadyKnown: false };
  } catch {
    // The RPC may have accepted the exact bytes before a timeout. Never create another transfer here.
    return { hash, state: "unknown", canResubmit:false, message: "Submission outcome is uncertain. Track this exact hash; do not prepare a replacement payment." };
  }
}
