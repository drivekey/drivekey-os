import './engine/offline-signer/network-deny';
import {authorizePrivateView} from './engine/offline-signer/hinkal-view';
import {inspectProductNotes} from './engine/offline-signer/private-note-manifest';
import {inspectPublicNotePage} from './engine/offline-signer/hinkal-note-discovery';
import {validateViewRequest,assertViewWallet,viewReview,verifyViewResponse} from './engine/core/hinkal-view';
import {createVault, inspectVault, verifyVault, reviewRequest, signReviewed, verifySavedSignature} from './signer';
import {reviewProductProof,authorizeProductProof} from './engine/offline-signer/hinkal-product-proof';
import {verifyProductProofResponse} from './engine/core/hinkal-product-proof';
import {verifyProductProofResult} from './engine/core/hinkal-product-result';
import {verifyProductChain,verifyProductChainResponse,productChainReview} from './engine/core/hinkal-product-chain';
import {verifyProductPackageChain} from './engine/core/hinkal-product-admission';
const paymentPolicy = require('./tools/store-payment-policy.cjs');
export interface OfflineExecutionPolicy {
  assertIntent(request:unknown,context?:{action:string,wallet:unknown}):void|Promise<void>;
  assertPrivateView(request?:unknown,context?:{action:string,wallet:unknown}):void|Promise<void>;
  assertProductProof(request?:unknown,context?:{action:string,wallet:unknown}):void|Promise<void>;
}
// Both CLI and the explicit unfunded fixture broker call the same dispatcher.
// Requiring this module never installs another stdin reader or child process.
// Only a trusted in-process caller can supply policy functions. They are never
// read from a job, renderer flag, environment variable or CLI JSON property.
export async function executeOfflineJob(input:any,executionPolicy:OfflineExecutionPolicy=paymentPolicy):Promise<unknown> {
  let job:any;
  try {
    const text=JSON.stringify(input);
    if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024)throw Error('Offline job exceeds its bounded format.');
    job=JSON.parse(text);
    if(!job||typeof job!=='object'||Array.isArray(job))throw Error('Expected an offline job.');
    if(!executionPolicy||['assertIntent','assertPrivateView','assertProductProof'].some(name=>typeof(executionPolicy as any)[name]!=='function'))throw Error('A trusted execution policy is required.');
    const authorize=async(method:keyof OfflineExecutionPolicy,request?:unknown)=>{const scope=structuredClone({request,context:{action:job.action,wallet:job.vault?.public??job.wallet}}),freeze=(value:any)=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(scope);const result=await executionPolicy[method](scope.request,scope.context);if(result!==undefined)throw Error('Execution authority did not authorize the operation.');};
    let result: unknown;
    switch(job.action) {
      case 'review-private-view': {const r=validateViewRequest(job.request);assertViewWallet(r,job.wallet);result=viewReview(r);break;}
      case 'authorize-private-view': await authorize('assertPrivateView',job.request);result=await authorizePrivateView(job.vault,job.password,job.request,job.fingerprint);break;
      case 'verify-private-view': {const r=validateViewRequest(job.request,Date.now(),false);assertViewWallet(r,job.wallet||job.vault?.public);result={response:verifyViewResponse(r,job.response,Date.now(),false)};break;}
      case 'create': result = await createVault(job.password); break;
      case 'inspect': result = inspectVault(job.vault); break;
      case 'verify': result = await verifyVault(job.vault,job.password); break;
      case 'review': await authorize('assertIntent',job.request); if(job.request?.version===29)await verifyProductChain(job.request,job.vault?.public); result = reviewRequest(job.request,job.vault); break;
      case 'sign': await authorize('assertIntent',job.request); result = await signReviewed(job.vault,job.password,job.request,job.fingerprint); break;
      case 'verify-saved': result = await verifySavedSignature(job.vault,job.request,job.response); break;
      case 'review-product-proof': result = reviewProductProof(job.request,job.vault); break;
      case 'inspect-public-notes': await authorize('assertPrivateView');result=await inspectPublicNotePage(job.vault,job.password,job.wallet,job.manifest,job.page);break;
      case 'inspect-product-notes': await authorize('assertProductProof',job.request); result=await inspectProductNotes(job.vault,job.password,job.request);break;
      case 'sign-product-proof': await authorize('assertProductProof',job.request);if(typeof job.noteManifestFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(job.noteManifestFingerprint))throw Error('The independently owned note reservation is required.'); result = await authorizeProductProof(job.vault,job.password,job.request,job.fingerprint,Date.now(),job.noteManifestFingerprint); break;
      case 'verify-product-proof': reviewProductProof(job.request,job.vault,Date.now(),false); result = {response:await verifyProductProofResponse(job.request,job.response,Date.now(),false)}; break;
      case 'verify-product-proof-result': reviewProductProof(job.request,job.vault,Date.now(),false); result = {result:await verifyProductProofResult(job.request,job.response,job.result,Date.now(),false)}; break;
      case 'verify-product-chain-envelope': {const r=await verifyProductChain(job.request,job.wallet,Date.now(),false);result={review:productChainReview(r,Date.now(),false),...(job.response?{response:await verifyProductChainResponse(job.response,r,job.wallet,Date.now(),false)}:{})};break;}
      case 'verify-product-proof-chain': result=await verifyProductPackageChain(job.package,job.wallet,job.request,Date.now(),false); break;
      default: throw Error('Unsupported operation.');
    }
    return result;
  } finally {if(job&&typeof job==='object')job.password=undefined;if(input&&typeof input==='object'){try{input.password=undefined;}catch{}}}
}
if(require.main === module) {
const MAX = 1024 * 1024;
let bytes = 0, chunks: Buffer[] = [];
const clearChunks = () => { chunks.forEach(b => b.fill(0)); chunks = []; };
process.stdin.on('data', (chunk: Buffer) => {
  bytes += chunk.length;
  if (bytes > MAX) { chunk.fill(0); clearChunks(); process.exit(2); }
  chunks.push(chunk);
});
process.stdin.on('end', async () => {
  let job: any;
  try {
    const raw = Buffer.concat(chunks); clearChunks();
    try { job = JSON.parse(raw.toString('utf8')); } finally { raw.fill(0); }
    const result = await executeOfflineJob(job);job = undefined;
    process.stdout.write(JSON.stringify({ok:true,result}), () => process.exit(0));
  } catch {
    // Library/validation exceptions can contain user input or secret material.
    // Never serialize a key-bearing worker's exception across the IPC boundary.
    if(job && typeof job === 'object')job.password = undefined;
    job = undefined; clearChunks();
    process.stdout.write(JSON.stringify({ok:false,error:'Local signer rejected the operation. Check the passphrase, vault and reviewed request.'}), () => process.exit(1));
  }
});
process.stdin.on('error', () => { clearChunks(); process.exit(2); });
}
