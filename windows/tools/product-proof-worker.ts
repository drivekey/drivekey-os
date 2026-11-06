import '../engine/offline-signer/network-deny';
import {z} from 'zod';
import {proveProductProof} from '../engine/offline-signer/hinkal-product-prover';
import {validateProductProof,verifyProductProofResponse} from '../engine/core/hinkal-product-proof';
import {assertProductPackageWallet} from '../engine/core/hinkal-product-admission';
const policy=require('./store-payment-policy.cjs');
const schema=z.object({action:z.literal('prove-product-proof'),vault:z.unknown(),password:z.string().min(16).max(256),request:z.unknown(),response:z.unknown(),artifactDirectory:z.string().max(4096)}).strict();
interface ProductProofExecutionPolicy {assertProductProof(request:unknown,context?:{action:string,wallet:unknown}):void|Promise<void>;}
// Public check for the protected broker, before it decrypts an unlock secret.
// The prover repeats verification against its own immutable job before keys.
export async function verifyProductProofJobAuthorization(request:unknown,response:unknown,wallet:unknown){
 const r=validateProductProof(structuredClone(request));assertProductPackageWallet(r,structuredClone(wallet));
 return verifyProductProofResponse(r,structuredClone(response));
}
// The normal CLI uses only its release policy. A separately packaged unfunded
// broker may supply trusted functions after matching the protected exact job.
export async function executeProductProofJob(input:any,executionPolicy:ProductProofExecutionPolicy=policy){
 let job:any;
 try{
  const text=JSON.stringify(input);if(typeof text!=='string'||Buffer.byteLength(text)>256*1024)throw Error('Offline proof job exceeds its bounded format.');
  job=schema.parse(JSON.parse(text));
  if(!executionPolicy||typeof executionPolicy.assertProductProof!=='function')throw Error('A trusted offline proof policy is required.');
  const scope=structuredClone({request:job.request,context:{action:job.action,wallet:job.vault?.public}}),freeze=(v:any)=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}};freeze(scope);
  if(await executionPolicy.assertProductProof(scope.request,scope.context)!==undefined)throw Error('Offline proof authority did not authorize the job.');
  return await proveProductProof(job.vault,job.password,job.request,job.response,job.artifactDirectory);
 }finally{if(job)job.password=undefined;if(input&&typeof input==='object'){try{input.password=undefined;}catch{}}}
}
if(require.main===module){
let bytes=0,parts:Buffer[]=[];
const clear=()=>{parts.forEach(p=>p.fill(0));parts=[];};
process.stdin.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>256*1024){b.fill(0);clear();process.exit(2);}parts.push(b);});
process.stdin.on('end',async()=>{let job:any;try{
 const raw=Buffer.concat(parts);clear();try{job=JSON.parse(raw.toString('utf8'));}finally{raw.fill(0);}
 const result=await executeProductProofJob(job);job=undefined;
 process.stdout.write(JSON.stringify({ok:true,result}),()=>process.exit(0));
}catch{if(job)job.password=undefined;job=undefined;clear();process.stdout.write(JSON.stringify({ok:false,error:'Offline proof creation was rejected. Preserve the approved request and authorization.'}),()=>process.exit(1));}});
process.stdin.on('error',()=>{clear();process.exit(2);});
}
