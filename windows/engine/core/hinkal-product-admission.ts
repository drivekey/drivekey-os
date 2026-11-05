import {z} from 'zod';
import {Transaction,keccak256} from 'ethers';
import {canonical} from './payment-intent';
import {multiPublicSchema} from './multi-protocol';
import {validateProductProof,verifyProductProofChainLink} from './hinkal-product-proof';
import {productAuthorizationHash,verifyProductProofResult} from './hinkal-product-result';
import {inspectHinkalSolanaSwap} from './hinkal-solana-swap';
const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const packageSchema=z.object({version:z.literal(28),kind:z.literal('drivekey-hinkal-product-proof-package'),request:z.unknown(),response:z.unknown(),result:z.unknown()}).strict();
export const productBindingSchema=z.object({version:z.literal(28),requestFingerprint:hash,authorizationHash:hash,proofResultHash:hash,chainFingerprint:hash}).strict();
export function assertProductPackageWallet(request:any,wallet:unknown){
 const w=multiPublicSchema.parse(wallet);
 if(canonical(request.wallet)!==canonical(w))throw Error('Product proof package belongs to another public wallet.');return w;
}
export async function verifyProductProofPackage(input:unknown,wallet:unknown,now=Date.now(),expiry=true){
 const p=packageSchema.parse(input);
 if(Buffer.byteLength(JSON.stringify(p))>256*1024)throw Error('Product proof package exceeds the file limit.');
 const request=validateProductProof(p.request,now,expiry);assertProductPackageWallet(request,wallet);
 const result=await verifyProductProofResult(request,p.response,p.result,now,expiry);
 return {...p,request,result};
}
export function productChainBinding(p:any,request:any){
 return productBindingSchema.parse({version:28,requestFingerprint:p.request.fingerprint,authorizationHash:productAuthorizationHash(p.response),
  proofResultHash:keccak256(Buffer.from(canonical(p.result))),chainFingerprint:request.fingerprint});
}
export async function verifyProductPackageChain(input:unknown,wallet:unknown,chainRequest:unknown,now=Date.now(),expiry=true){
 const p=await verifyProductProofPackage(input,wallet,now,expiry),r=await verifyProductProofChainLink(p.request,p.response,chainRequest,now,expiry);
 if(r.deviceId!==p.request.deviceId||r.chain!==p.request.chain||Date.parse(r.createdAt)<Date.parse(p.result.createdAt)||Date.parse(r.expiresAt)>Date.parse(p.request.expiresAt))
  throw Error('Chain request exceeds the approved product proof lifetime or identity.');
 if(p.request.chain==='ethereum'){
  if(r.version!==18||Transaction.from(r.unsignedTransaction).data!==(p.result.proof as any).data)throw Error('Chain request substituted the exported Ethereum proof bytes.');
 }else{
  if(r.version!==21)throw Error('Chain request substituted the Solana transaction version.');
  const a=inspectHinkalSolanaSwap(r as any).args,normalized={...a,proofAArr:Array.from(a.proofAArr),proofBArr:Array.from(a.proofBArr),proofCArr:Array.from(a.proofCArr),publicInputsArr:a.publicInputsArr.map((row:any)=>Array.from(row)),encryptedOutputs:a.encryptedOutputs.map((row:any)=>Array.from(row))};
  if(canonical(normalized)!==canonical((p.result.proof as any).solanaArgs))throw Error('Chain request substituted the exported Solana proof bytes.');
 }
 return {request:r,productProof:productChainBinding(p,r)};
}
export async function prepareProductChain(prepare:(chain:'ethereum'|'solana',input:any,wallet:any,now:number)=>Promise<unknown>,input:unknown,wallet:unknown,now=Date.now()){
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),w=structuredClone(wallet),p=await verifyProductProofPackage(structuredClone(input),w,clock()),s:any=p.response;
 const args=structuredClone({seed:p.request.seed,authorization:s.proofAuthorization,proof:p.result.proof,productExpiresAt:p.request.expiresAt});
 const request=await prepare(p.request.chain,args,structuredClone(w),clock()),verified=await verifyProductPackageChain(p,w,request,clock());validateProductProof(p.request,clock());return verified;
}
