import {solanaEvidence} from './transaction-evidence';
import { z } from "zod";
import {sha256} from 'ethers';
import {randomUUID} from 'node:crypto';
import type {NonceSetupStore,SetupClaim,SetupResolution} from './nonce-setup-ledger';
import { Connection, NonceAccount, PublicKey, SystemProgram, VersionedTransaction, NONCE_ACCOUNT_LENGTH } from "@solana/web3.js";
import { multiPublicSchema, SOLANA_GENESIS } from "./multi-protocol";
import { checkSolanaCluster } from "./multi-online";
import { noncePublicKey, nonceQuoteSchema, NONCE_SETUP_QUOTE_MS, nonceSeed, nonceAddress, nonceCreationTransaction, unsignedNonceBytes, validateNonceQuote, verifyNonceSigned, type NonceQuote } from "./nonce-setup-protocol";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("nonce-capabilities")}).strict(),
  z.object({action:z.literal("nonce-check"),wallet:multiPublicSchema,address:noncePublicKey}).strict(),
  z.object({action:z.literal("nonce-prepare"),wallet:multiPublicSchema,sponsor:noncePublicKey}).strict(),
  z.object({action:z.literal("nonce-preflight"),wallet:multiPublicSchema,quote:nonceQuoteSchema}).strict(),
  z.object({action:z.literal("nonce-submit"),wallet:multiPublicSchema,quote:nonceQuoteSchema,raw:z.string().max(2400),consent:z.literal(true)}).strict(),
  z.object({action:z.literal("nonce-status"),wallet:multiPublicSchema,quote:nonceQuoteSchema,raw:z.string().max(2400)}).strict(),
]);
export async function checkNonceAccount(c:Connection,address:string,authority:string) {
  const info=await c.getAccountInfo(new PublicKey(address),"finalized");
  if(!info) return {state:"missing" as const,address};
  if(info.executable||!info.owner.equals(SystemProgram.programId)||info.data.length!==NONCE_ACCOUNT_LENGTH||
    info.data.readUInt32LE(0)!==1||info.data.readUInt32LE(4)!==1)
    throw Error("That address is not an initialized current-version durable nonce account.");
  const nonce=NonceAccount.fromAccountData(info.data);
  if(nonce.authorizedPubkey.toBase58()!==authority) throw Error("Nonce authority must be your offline wallet—not the funding wallet.");
  if(info.lamports<await c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH,"finalized"))
    throw Error("Nonce account does not meet the rent deposit requirement.");
  return {state:"ready" as const,address,authority,nonce:nonce.nonce};
}
async function fresh(q:NonceQuote,c:Connection) {
  if(q.version!==2||Date.now()>=Date.parse(q.expiresAt))throw Error('Setup quote expired. Review a new quote.');
  if(!(await c.isBlockhashValid(q.blockhash,{commitment:"confirmed"})).value||await c.getBlockHeight('confirmed')>q.lastValidBlockHeight)
    throw Error("Setup quote expired. Refresh the quote and review the costs again.");
  if(await c.getAccountInfo(new PublicKey(q.nonceAccount),"confirmed"))
    throw Error("Nonce address already exists. Check its status; do not pay again.");
  const rent=await c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH,"confirmed");
  const fee=(await c.getFeeForMessage(nonceCreationTransaction(q).compileMessage(),"confirmed")).value;
  if(rent!==q.depositLamports||fee===null||fee!==q.feeLamports) throw Error("Setup costs changed. Review a fresh quote.");
  if(await c.getBalance(new PublicKey(q.sponsor),"confirmed")<rent+fee)
    throw Error("Funding wallet needs enough SOL for the displayed deposit and fee.");
}
export async function nonceSetupAction(input:unknown,c:Connection,enabled=false,store?:NonceSetupStore) {
  const a=schema.parse(input);
  if(a.action==="nonce-capabilities")return {setupEnabled:enabled,transferEnabled:false};
  await checkSolanaCluster(c);
  if(a.action==="nonce-check")return checkNonceAccount(c,a.address,a.wallet.solanaAddress);
  if(a.action==="nonce-prepare") {
    if(a.sponsor===a.wallet.solanaAddress)throw Error("Use a separate funding wallet, never import your USB key.");
    const address=await nonceAddress(a.sponsor,a.wallet.solanaAddress);
    const existing=await checkNonceAccount(c,address,a.wallet.solanaAddress);
    if(existing.state==="ready")return {...existing,setupEnabled:enabled};
    const [deposit,latest]=await Promise.all([
      c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH,"confirmed"),c.getLatestBlockhash("confirmed")]);
    const now=Date.now();
    const q:NonceQuote={version:2,kind:"drivekey-nonce-setup",requestId:randomUUID(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+NONCE_SETUP_QUOTE_MS).toISOString(),genesisHash:SOLANA_GENESIS,deviceId:a.wallet.deviceId,
      authority:a.wallet.solanaAddress,sponsor:a.sponsor,nonceAccount:address,seed:nonceSeed(a.wallet.solanaAddress),
      depositLamports:deposit,feeLamports:5000,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,unsignedTransaction:""};
    q.unsignedTransaction=unsignedNonceBytes(nonceCreationTransaction(q));
    const fee=(await c.getFeeForMessage(nonceCreationTransaction(q).compileMessage(),"confirmed")).value;
    if(fee===null)throw Error("Setup fee unavailable. Nothing signed or submitted.");
    q.feeLamports=fee;
    await validateNonceQuote(q,a.wallet,true); await fresh(q,c);
    return {state:"quoted",quote:q,setupEnabled:enabled};
  }
  const q=await validateNonceQuote(a.quote,a.wallet);
  if(a.action==="nonce-preflight") {
    await fresh(q,c); return {state:"ready-to-sign",setupEnabled:enabled};
  }
  const verified=await verifyNonceSigned(a.raw,q,a.wallet);
  const record:SetupClaim={version:1,kind:'solana-setup',purpose:'nonce-setup',protocolVersion:q.version,genesis:q.genesisHash,from:q.sponsor,signature:verified.hash,destination:q.nonceAccount,authority:q.authority,blockhash:q.blockhash,lastValidBlockHeight:q.lastValidBlockHeight,fingerprint:sha256(new TextEncoder().encode(JSON.stringify(q))),signedBytesDigest:sha256(Buffer.from(a.raw,'base64')),expiresAt:q.version===2?q.expiresAt:'1970-01-01T00:00:00.000Z'};
  const identity={family:'solana' as const,genesis:q.genesisHash,signature:verified.hash};
  const matches=(other:unknown)=>!!other&&typeof other==='object'&&Object.keys(other).length===Object.keys(record).length&&Object.entries(record).every(([key,value])=>(other as Record<string,unknown>)[key]===value);
  const uncertain={state:'unknown',hash:verified.hash,canResubmit:false,replacementAllowed:false,message:'Setup outcome is unresolved. Check the saved transaction; do not submit again.'};
  async function resolve(evidence:SetupResolution){
    if(!store)return false;const prior=await store.read(identity);
    if(!prior)return true; // No claim for these bytes. Other destination claims still block atomically.
    if(!matches(prior))throw Error('Setup journal identity changed. Reconcile before continuing.');
    return store.resolve(record,evidence);
  }
  const s=(await c.getSignatureStatuses([verified.hash],{searchTransactionHistory:true})).value[0];
  if(s) {
    if(s.confirmationStatus!=="finalized")return {state:"pending",hash:verified.hash};
    const evidence=await solanaEvidence(verified.hash,a.raw,c);
    if(evidence.state==='submitted'||evidence.state==='unknown')return {...evidence,state:"pending"};
    if(evidence.state==='failed'){
      const absent=!(await c.getAccountInfo(new PublicKey(q.nonceAccount),'finalized'));
      const replacementAllowed=absent&&await resolve({version:1,reason:'finalized-failure',observedAt:new Date().toISOString(),finalizedHeight:await c.getBlockHeight('finalized'),destinationAbsent:true,signatureAbsent:false,blockhashInvalid:false});
      return {state:'failed',hash:verified.hash,replacementAllowed,canResubmit:false,message:'Setup failed on-chain. A network fee may have been charged. Reconcile before a new approval.'};
    }
    const account=await checkNonceAccount(c,q.nonceAccount,q.authority);
    if(account.state!=="ready")throw Error("Transaction finalized but nonce account is not ready.");
    return {...account,hash:verified.hash,transactionVerified:true,finality:'finalized'};
  }
  if(a.action==="nonce-status") {
    const valid=(await c.isBlockhashValid(q.blockhash,{commitment:"finalized"})).value;
    const account=await checkNonceAccount(c,q.nonceAccount,q.authority);
    if(account.state==="ready")return {...account,hash:verified.hash,message:"Account verified on-chain; this signature was not found."};
    const expired=!valid && await c.getBlockHeight("finalized") > q.lastValidBlockHeight;
    const replacementAllowed=expired&&await resolve({version:1,reason:'finalized-expiry',observedAt:new Date().toISOString(),finalizedHeight:await c.getBlockHeight('finalized'),destinationAbsent:true,signatureAbsent:true,blockhashInvalid:true});
    return {state:expired?"expired":"unknown",hash:verified.hash,replacementAllowed,canResubmit:false,message:!expired?
      "No confirmed result yet. Check again; do not submit a replacement.":
      replacementAllowed?'Finalized expiry and absent account verified. You may prepare a new quote; this attempt will never be resent.':'Finalized expiry observed. Shared journal reconciliation is still required before a replacement.'};
  }
  if(!enabled)throw Error("Nonce setup submission is disabled. Nothing sent.");
  await validateNonceQuote(q,a.wallet,true);
  if(!store)throw Error('Durable setup journal is required before submission.');
  const prior=await store.read(identity);if(prior){if(!matches(prior))throw Error('Setup journal identity changed.');return uncertain;}
  await fresh(q,c);
  const simulation=await c.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(a.raw,"base64")),
    {sigVerify:true,replaceRecentBlockhash:false,commitment:"confirmed"});
  if(simulation.value.err)throw Error("Setup simulation failed. Nothing submitted.");
  await fresh(q,c); // Simulation cannot extend the blockhash lifetime or change setup costs.
  if(!await store.claim(record))return uncertain;
  if(!matches(await store.read(identity)))throw Error('Setup claim could not be verified. Nothing broadcast.');
  await fresh(q,c);
  try {
    const hash=await c.sendRawTransaction(Buffer.from(a.raw,"base64"),{skipPreflight:false,maxRetries:0,preflightCommitment:"confirmed"});
    if(hash!==verified.hash)throw Error("Unexpected signature.");
    return {state:"submitted",hash,message:"Submitted—not confirmed. Check status before continuing."};
  } catch {return {state:"unknown",hash:verified.hash,message:"Submission outcome unknown. Check status; do not retry payment."};}
}
