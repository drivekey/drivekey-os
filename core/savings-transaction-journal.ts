// Public audit journal. Restoring a file grants neither submission permission nor chain trust.
import {z} from 'zod';
import {parseStrictPublicJson} from './strict-public-json';
import {savingsTransactionRequestSchema,savingsTransactionResponseSchema,verifySavingsTransactionResponse,reviewSavingsTransaction,savingsTransactionFlags} from './savings-transaction';
const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const observation=z.object({provenance:z.literal('host-rpc'),transactionHash:hash,blockHash:hash,blockNumber:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 status:z.union([z.literal(0),z.literal(1)])}).strict();
const entry=z.object({request:savingsTransactionRequestSchema,response:savingsTransactionResponseSchema,submissionAttempted:z.boolean(),observation:observation.nullable()}).strict();
export const savingsTransactionJournalSchema=z.object({kind:z.literal('drivekey-savings-transaction-journal'),version:z.literal(1),entries:z.array(entry).max(4),
 chainAuthenticated:z.literal(false),fundingReady:z.literal(false),productionReady:z.literal(false)}).strict();
export type SavingsTransactionJournal=z.infer<typeof savingsTransactionJournalSchema>;
export function emptySavingsTransactionJournal():SavingsTransactionJournal{return {kind:'drivekey-savings-transaction-journal',version:1,entries:[],chainAuthenticated:false,fundingReady:false,productionReady:false};}
function validate(input:unknown){
 const j=savingsTransactionJournalSchema.parse(input),hashes=new Set<string>(),nonces=new Set<string>();
 for(const e of j.entries){
  // Historical signedAt is descriptive only. This validates old byte binding,
  // never makes an expired transaction eligible for a fresh submission.
  verifySavingsTransactionResponse(e.response,e.request,Date.parse(e.response.signedAt));
  const nonce=e.request.gasPayer+':'+e.request.gas.nonce;
  if(hashes.has(e.response.transactionHash)||nonces.has(nonce))throw Error('Duplicate transaction or conflicting gas-wallet nonce. Reconcile before replacement.');
  hashes.add(e.response.transactionHash);nonces.add(nonce);
  if(e.observation&&(!e.submissionAttempted||e.observation.transactionHash!==e.response.transactionHash))throw Error('Observation differs from the attempted transaction.');
 }
 if(new TextEncoder().encode(JSON.stringify(j)).length>262144)throw Error('Savings journal exceeds limit.');return j;
}
export function stageSavingsTransaction(input:unknown,request:unknown,response:unknown,now=Date.now()){
 const j=validate(input),r=reviewSavingsTransaction(request,now).request,s=verifySavingsTransactionResponse(response,r,now);
 return validate({...j,entries:[...j.entries,{request:r,response:s,submissionAttempted:false,observation:null}]});
}
/** Save this replacement journal BEFORE network I/O. The public marker cannot prove a save occurred. */
export function markSavingsSubmissionAttempt(input:unknown,transactionHash:string,now=Date.now()){
 const j=validate(input),e=j.entries.find(e=>e.response.transactionHash===transactionHash);if(!e)throw Error('Unknown savings transaction.');
 if(e.submissionAttempted)throw Error('Previous submission needs reconciliation; no automatic retry.');
 reviewSavingsTransaction(e.request,now);verifySavingsTransactionResponse(e.response,e.request,now);
 return validate({...j,entries:j.entries.map(v=>v===e?{...v,submissionAttempted:true,observation:null}:v)});
}
export function recordSavingsSubmissionObservation(input:unknown,transactionHash:string,reported:unknown){
 const j=validate(input),e=j.entries.find(e=>e.response.transactionHash===transactionHash);if(!e||!e.submissionAttempted)throw Error('No recorded submission attempt.');
 const o=reported===null?null:observation.parse(reported);
 return validate({...j,entries:j.entries.map(v=>v===e?{...v,observation:o}:v)});
}
export function restoreSavingsTransactionJournal(text:string){
 const j=validate(parseStrictPublicJson(text,262144));
 // Discard saved receipt claims. Even a forged attempted=false must not allow retry.
 const journal=validate({...j,entries:j.entries.map(e=>({...e,submissionAttempted:true,observation:null}))});
 return {journal,status:'reconciliation-required' as const,submissionAllowed:false as const,approvalRestored:false as const,...savingsTransactionFlags};
}
