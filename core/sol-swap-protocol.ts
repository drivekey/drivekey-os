import { z } from 'zod';
import { PublicKey,VersionedTransaction } from '@solana/web3.js';
import { keccak256,formatUnits } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { multiPublicSchema,SOLANA_GENESIS } from './multi-protocol';
import { buildJupiterLegacyMessage,validateJupiterAncillary } from './jupiter-account-policy';
import { inspectDirectJupiterRoute } from './jupiter-route-inspection';
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pub=z.string().max(44).refine(s=>{try{return new PublicKey(s).toBase58()===s;}catch{return false;}});
const units=z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine(s=>BigInt(s)<2n**64n);
const digest=z.string().regex(/^0x[0-9a-f]{64}$/);
const ix=z.object({programId:pub,accounts:z.array(z.object({pubkey:pub,isSigner:z.boolean(),isWritable:z.boolean()}).strict()).max(64),data:z.string().max(1024)}).strict();
// Only fields which describe actual instructions or their checked interpretation travel offline.
export const solSwapBuildSchema=z.object({inputMint:z.enum([SOL,USDC]),outputMint:z.enum([SOL,USDC]),inAmount:units,outAmount:units,otherAmountThreshold:units,slippageBps:z.number().int().min(0).max(100),swapMode:z.literal('ExactIn'),routePlan:z.array(z.object({percent:z.literal(100),bps:z.literal(10000),swapInfo:z.object({ammKey:pub,label:z.literal('Raydium CLMM'),inputMint:pub,outputMint:pub,inAmount:units,outAmount:units}).strict()}).strict()).length(1),swapInstruction:ix,setupInstructions:z.array(ix).max(4),cleanupInstruction:ix,computeBudgetInstructions:z.array(ix).max(1),otherInstructions:z.array(ix).length(0),tipInstruction:z.null()}).strict();
export const solSwapSchema=z.object({version:z.literal(4),network:z.literal('solana'),kind:z.literal('swap'),genesisHash:z.literal(SOLANA_GENESIS),requestId:z.string().uuid(),deviceId:z.string().uuid(),from:pub,createdAt:z.string().datetime(),expiresAt:z.string().datetime(),nonceAccount:pub,nonceValue:pub,nonceFee:units,tokenAccountRent:units,build:solSwapBuildSchema,tickStarts:z.record(pub,z.number().int().min(-444000).max(443636)).refine(v=>Object.keys(v).length<=4),unsignedMessage:z.string().max(1800),fingerprint:digest}).strict();
export type SolSwapRequest=z.infer<typeof solSwapSchema>;
const responseSchema=z.object({version:z.literal(4),network:z.literal('solana'),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:digest,signedAt:z.string().datetime(),rawSignedTransaction:z.string().max(1800),transactionHash:z.string().max(90),approvalSignature:z.string().max(90)}).strict();
function ordered(v:unknown):unknown{if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,ordered(x)]));return v;}
export function solSwapFingerprint(r:Omit<SolSwapRequest,'fingerprint'>|SolSwapRequest){return keccak256(new TextEncoder().encode(JSON.stringify(['DriveKey Solana swap v4',ordered(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='fingerprint')))])));}
export function solSwapApproval(r:SolSwapRequest){return new TextEncoder().encode('DriveKey Solana swap approval v4\n'+r.fingerprint);}
export function solSwapExpected(r:Pick<SolSwapRequest,'from'|'build'>){return {from:r.from,inputMint:r.build.inputMint,amount:r.build.inAmount,slippageBps:r.build.slippageBps};}
export function validateSolSwap(input:unknown,now=Date.now(),checkExpiry=true){
 const r=solSwapSchema.parse(input),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 if(expires<=created||expires-created>1800000||created>now+60000||expires%1000!==0)throw Error('Invalid Solana swap lifetime or clock.');
 if(checkExpiry&&now>=expires)throw Error('Solana swap request expired.');
 if(solSwapFingerprint(r)!==r.fingerprint)throw Error('Solana swap fingerprint mismatch.');
 const expected=solSwapExpected(r),ancillary=validateJupiterAncillary(r.build,expected);
 if(BigInt(r.nonceFee)<=0n||BigInt(r.nonceFee)+BigInt(ancillary.maximumPriorityFee)>10000000n||BigInt(r.tokenAccountRent)>10000000n||(ancillary.createdAccounts>0&&BigInt(r.tokenAccountRent)===0n)||BigInt(r.tokenAccountRent)*BigInt(ancillary.createdAccounts)>20000000n)throw Error('Solana swap fee or rent bounds exceeded.');
 const message=buildJupiterLegacyMessage(r.build,expected,r.tickStarts,r.nonceAccount,r.nonceValue);
 if(Buffer.from(message.serialize()).toString('base64')!==r.unsignedMessage)throw Error('Solana swap bytes differ from the complete reviewed action.');
 return r;
}
export function verifySolSwapResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),checkExpiry=true){
 const r=validateSolSwap(request,now,checkExpiry),w=multiPublicSchema.parse(wallet),s=responseSchema.parse(input);
 if(w.deviceId!==r.deviceId||w.solanaAddress!==r.from||s.requestId!==r.requestId||s.deviceId!==r.deviceId||s.fingerprint!==r.fingerprint)throw Error('Solana swap response belongs to another request or wallet.');
 const raw=Buffer.from(s.rawSignedTransaction,'base64');if(raw.toString('base64')!==s.rawSignedTransaction||raw.length>1232)throw Error('Invalid Solana swap transaction encoding.');
 const tx=VersionedTransaction.deserialize(raw),message=tx.message.serialize();
 if(tx.message.version!=='legacy'||tx.signatures.length!==1||Buffer.from(message).toString('base64')!==r.unsignedMessage||bs58.encode(tx.signatures[0])!==s.transactionHash||!nacl.sign.detached.verify(message,tx.signatures[0],new PublicKey(r.from).toBytes())||!nacl.sign.detached.verify(solSwapApproval(r),bs58.decode(s.approvalSignature),new PublicKey(r.from).toBytes()))throw Error('Solana swap signature or transaction mismatch.');
 if(Date.parse(s.signedAt)<Date.parse(r.createdAt)-60000||Date.parse(s.signedAt)>=Date.parse(r.expiresAt)||Date.parse(s.signedAt)>now+60000)throw Error('Invalid Solana swap signing time.');
 return s;
}
export function solSwapReview(input:unknown,checkExpiry=true){
 const r=validateSolSwap(input,Date.now(),checkExpiry),expected=solSwapExpected(r),decoded=inspectDirectJupiterRoute(r.build,expected),fees=validateJupiterAncillary(r.build,expected),solInput=r.build.inputMint===SOL;
 return {action:'swap',network:'Solana mainnet',from:r.from,recipient:r.from,inputMint:r.build.inputMint,outputMint:r.build.outputMint,amount:formatUnits(r.build.inAmount,solInput?9:6)+' '+(solInput?'SOL':'USDC'),minimumReceived:formatUnits(decoded.minimumOutput,solInput?6:9)+' '+(solInput?'USDC':'SOL'),slippage:r.build.slippageBps/100+'%',route:'Jupiter route_v2 / Raydium CLMM / '+decoded.pool,maximumFee:formatUnits(BigInt(r.nonceFee)+BigInt(fees.maximumPriorityFee),9)+' SOL',maximumAccountRent:formatUnits(BigInt(r.tokenAccountRent)*BigInt(fees.createdAccounts),9)+' SOL',nonceAccount:r.nonceAccount,nonceValue:r.nonceValue,deadlineUTC:r.expiresAt,fingerprint:r.fingerprint,warning:'Application expiry does not revoke signed durable-nonce bytes. Output and wrapped-SOL cleanup return only to this wallet. Any failed submission must be reconciled before preparing another swap.'};
}
