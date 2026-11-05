import {z} from 'zod';
import {getAddress,keccak256,verifyMessage} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonical} from './payment-intent';
import {validateProductProof,productProofReview} from './hinkal-product-proof';
import {assertProductPackageWallet,verifyProductPackageChain} from './hinkal-product-admission';
import {validateHinkalEvmSwap,hinkalEvmSwapReview,verifyHinkalEvmSwapResponse} from './hinkal-evm-swap-intent';
import {validateHinkalSolanaSwap,hinkalSolanaSwapReview,verifyHinkalSolanaSwapResponse} from './hinkal-solana-swap';

const hash=z.string().regex(/^0x[0-9a-f]{64}$/),uuid=z.string().uuid(),date=z.string().datetime();
const schema=z.object({version:z.literal(29),kind:z.literal('drivekey-hinkal-product-chain-request'),deviceId:uuid,requestId:uuid,
 chain:z.enum(['ethereum','solana']),createdAt:date,expiresAt:date,package:z.object({version:z.literal(28),kind:z.literal('drivekey-hinkal-product-proof-package'),request:z.unknown(),response:z.unknown(),result:z.unknown()}).strict(),chainRequest:z.unknown(),fingerprint:hash}).strict();
const responseSchema=z.object({version:z.literal(29),kind:z.literal('drivekey-hinkal-product-chain-response'),deviceId:uuid,requestId:uuid,fingerprint:hash,
 signedAt:date,rawSignedTransaction:z.string().min(1).max(41000),transactionHash:z.string().min(1).max(88),innerApprovalSignature:z.string().min(1).max(160),approvalSignature:z.string().min(1).max(160)}).strict();
export type ProductChainRequest=z.infer<typeof schema>;
export const productChainFingerprint=(input:any)=>{const {fingerprint,...body}=input;return keccak256(Buffer.from('DriveKey product private-chain intent v29\n'+canonical(body)));};
export const productChainApproval=(r:ProductChainRequest)=>'DriveKey product private-chain approval v29\n'+r.fingerprint;

/** Synchronous bounded parsing for review. Full authorization and Groth16 checks
 * are mandatory in verifyProductChain before signing or online consumption. */
export function validateProductChain(input:unknown,now=Date.now(),expiry=true){
 if(Buffer.byteLength(JSON.stringify(input)??'')>64*1024)throw Error('Product chain request exceeds the 64 KiB signing limit.');
 const r=schema.parse(input),p=validateProductProof(r.package.request,now,expiry),inner=r.chain==='ethereum'?validateHinkalEvmSwap(r.chainRequest,now,expiry):validateHinkalSolanaSwap(r.chainRequest,now,expiry);
 if(r.fingerprint!==productChainFingerprint(r)||r.deviceId!==p.deviceId||r.deviceId!==inner.deviceId||r.requestId!==inner.requestId||r.chain!==p.chain||r.chain!==inner.chain||
    r.createdAt!==inner.createdAt||r.expiresAt!==inner.expiresAt||Date.parse(r.createdAt)<Date.parse(p.createdAt)||Date.parse(r.expiresAt)>Date.parse(p.expiresAt))
  throw Error('Product chain envelope differs from its original approval or transaction.');
 return r;
}
export function assertProductChainWallet(r:ProductChainRequest,wallet:unknown){assertProductPackageWallet(r.package.request,wallet);}
export async function verifyProductChain(input:unknown,wallet:unknown,now=Date.now(),expiry=true){
 const r=validateProductChain(structuredClone(input),now,expiry);const w=structuredClone(wallet);assertProductChainWallet(r,w);
 await verifyProductPackageChain(r.package,w,r.chainRequest,now,expiry);return r;
}
export async function createProductChain(input:unknown,wallet:unknown,chainRequest:any,now=Date.now()){
 const p=structuredClone(input),inner=structuredClone(chainRequest),r={version:29,kind:'drivekey-hinkal-product-chain-request',deviceId:inner.deviceId,requestId:inner.requestId,
  chain:inner.chain,createdAt:inner.createdAt,expiresAt:inner.expiresAt,package:p,chainRequest:inner,fingerprint:''};
 r.fingerprint=productChainFingerprint(r);return verifyProductChain(r,wallet,now);
}
export function productChainReview(input:unknown,now=Date.now(),expiry=true){
 const r=validateProductChain(input,now,expiry),p=validateProductProof(r.package.request,now,expiry),inner=r.chain==='ethereum'?hinkalEvmSwapReview(r.chainRequest,now,expiry):hinkalSolanaSwapReview(r.chainRequest,now,expiry);
 const proofReview=productProofReview(p,now,expiry);
 return {...inner,inputToken:proofReview.inputToken,outputToken:proofReview.outputToken,decimals:proofReview.decimals,formattedInput:proofReview.formattedInput,formattedMinimum:proofReview.formattedMinimum,
  productMaximumFee:proofReview.maximumFee,productMaximumAccountRent:proofReview.maximumAccountRent,fingerprint:r.fingerprint,chainFingerprint:(r.chainRequest as any).fingerprint,productProofFingerprint:p.fingerprint,
  productApprovalDeadlineUTC:p.expiresAt,authority:'Exact chain transaction and original product proof approval v29'};
}
export function productInnerResponse(request:ProductChainRequest,input:unknown){
 const s=responseSchema.parse(input),inner:any=request.chainRequest;
 return {version:inner.version,deviceId:s.deviceId,requestId:s.requestId,fingerprint:inner.fingerprint,signedAt:s.signedAt,
  rawSignedTransaction:s.rawSignedTransaction,transactionHash:s.transactionHash,approvalSignature:s.innerApprovalSignature};
}
export async function verifyProductChainResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),expiry=true){
 const w:any=structuredClone(wallet),s=responseSchema.parse(structuredClone(input)),r=await verifyProductChain(request,w,now,expiry),at=Date.parse(s.signedAt);
 if(s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint||at<Date.parse(r.createdAt)||at>=Date.parse(r.expiresAt)||at>now+60000)
  throw Error('Product chain response differs from its approval.');
 const message=productChainApproval(r);
 if(r.chain==='ethereum'){
  if(getAddress(verifyMessage(message,s.approvalSignature))!==getAddress(w.evmAddress))throw Error('Product chain wallet approval differs.');
  verifyHinkalEvmSwapResponse(productInnerResponse(r,s),r.chainRequest,w,now,expiry);
 }else{
  if(!nacl.sign.detached.verify(Buffer.from(message),bs58.decode(s.approvalSignature),new PublicKey(w.solanaAddress).toBytes()))throw Error('Product chain wallet approval differs.');
  verifyHinkalSolanaSwapResponse(productInnerResponse(r,s),r.chainRequest,w,now,expiry);
 }
 return s;
}
