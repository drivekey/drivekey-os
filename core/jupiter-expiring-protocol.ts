import {z} from 'zod';
import {PublicKey,TransactionMessage,VersionedMessage,VersionedTransaction} from '@solana/web3.js';
import {keccak256,formatUnits} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {multiPublicSchema} from './multi-protocol';
import {solSwapSchema,solSwapExpected,type SolSwapRequest} from './sol-swap-protocol';
import {buildJupiterLegacyMessage,RAYDIUM_CLMM,validateJupiterAncillary} from './jupiter-account-policy';
import {JUPITER_PROGRAM,inspectDirectJupiterRoute} from './jupiter-route-inspection';
import {deadlineGuardIdentitySchema,deadlineGuardInstruction,deadlineSeconds,requireDeadlineGuard,type DeadlineGuardIdentity} from './solana-deadline-guard';

export const expiringJupiterSchema=solSwapSchema.extend({version:z.literal(1),kind:z.literal('jupiter-expiring-swap'),guard:deadlineGuardIdentitySchema}).strict();
export type ExpiringJupiterRequest=z.infer<typeof expiringJupiterSchema>;
export const expiringJupiterResponseSchema=z.object({version:z.literal(1),kind:z.literal('jupiter-expiring-swap'),network:z.literal('solana'),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),signedAt:z.string().datetime().max(64),rawSignedTransaction:z.string().max(1800),transactionHash:z.string().max(90),approvalSignature:z.string().max(90)}).strict();
export type ExpiringJupiterResponse=z.infer<typeof expiringJupiterResponseSchema>;
function ordered(v:unknown):unknown{if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,ordered(x)]));return v;}
export function expiringJupiterFingerprint(r:Omit<ExpiringJupiterRequest,'fingerprint'>|ExpiringJupiterRequest){return keccak256(new TextEncoder().encode(JSON.stringify(['DriveKey expiring Jupiter swap v1',ordered(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='fingerprint')))])));}
export function expiringJupiterApproval(r:ExpiringJupiterRequest){return new TextEncoder().encode('DriveKey expiring Jupiter swap approval v1\n'+r.fingerprint);}
export function buildExpiringJupiterMessage(r:Pick<ExpiringJupiterRequest,'from'|'build'|'tickStarts'|'nonceAccount'|'nonceValue'|'guard'|'expiresAt'>){
 const legacy=buildJupiterLegacyMessage(r.build,solSwapExpected(r),r.tickStarts,r.nonceAccount,r.nonceValue),decoded=TransactionMessage.decompile(legacy);
 const guard=requireDeadlineGuard(r.guard);
 if(decoded.instructions.some(ix=>ix.programId.toBase58()===guard.programId||ix.keys.some(k=>k.pubkey.toBase58()===guard.programId||k.pubkey.toBase58()===guard.programData)))throw Error('Deadline guard aliases a swap account.');
 // nonce advance, fixed compute limit, optional price, guard, financial effects
 const at=2+r.build.computeBudgetInstructions.length;decoded.instructions.splice(at,0,deadlineGuardInstruction(guard,r.expiresAt));
 const message=decoded.compileToLegacyMessage();if(message.header.numRequiredSignatures!==1||new VersionedTransaction(message).serialize().length>1232)throw Error('Guarded swap exceeds the static-account transaction policy.');return message;
}
export function validateExpiringJupiter(input:unknown,now=Date.now(),checkExpiry=true,acceptedGuard?:DeadlineGuardIdentity){
 const r=expiringJupiterSchema.parse(input),pin=requireDeadlineGuard(acceptedGuard),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 if(JSON.stringify(r.guard)!==JSON.stringify(pin))throw Error('Swap deadline guard is not the accepted immutable release.');
 if(expires<=created||expires-created>1800000||created>now+60000||!Number.isSafeInteger(created))throw Error('Invalid guarded swap lifetime or clock.');
 deadlineSeconds(r.expiresAt);if(checkExpiry&&now>=expires)throw Error('Guarded swap request expired.');
 if(expiringJupiterFingerprint(r)!==r.fingerprint)throw Error('Guarded swap fingerprint mismatch.');
 const ancillary=validateJupiterAncillary(r.build,solSwapExpected(r));
 if(BigInt(r.nonceFee)<=0n||BigInt(r.nonceFee)+BigInt(ancillary.maximumPriorityFee)>10000000n||BigInt(r.tokenAccountRent)>10000000n||(ancillary.createdAccounts>0&&BigInt(r.tokenAccountRent)===0n)||BigInt(r.tokenAccountRent)*BigInt(ancillary.createdAccounts)>20000000n)throw Error('Guarded swap fee or rent bounds exceeded.');
 if(Buffer.from(buildExpiringJupiterMessage(r).serialize()).toString('base64')!==r.unsignedMessage)throw Error('Guarded swap bytes differ from the complete reviewed action.');return r;
}
export function verifyExpiringJupiterResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),checkExpiry=true,acceptedGuard?:DeadlineGuardIdentity){
 const r=validateExpiringJupiter(request,now,checkExpiry,acceptedGuard),w=multiPublicSchema.parse(wallet),s=expiringJupiterResponseSchema.parse(input);
 if(w.deviceId!==r.deviceId||w.solanaAddress!==r.from||s.requestId!==r.requestId||s.deviceId!==r.deviceId||s.fingerprint!==r.fingerprint)throw Error('Guarded swap response belongs to another request or wallet.');
 const raw=Buffer.from(s.rawSignedTransaction,'base64');if(raw.toString('base64')!==s.rawSignedTransaction||raw.length>1232)throw Error('Invalid guarded swap encoding.');
 const tx=VersionedTransaction.deserialize(raw),message=tx.message.serialize();
 if(tx.message.version!=='legacy'||tx.signatures.length!==1||Buffer.from(message).toString('base64')!==r.unsignedMessage||bs58.encode(tx.signatures[0])!==s.transactionHash||!nacl.sign.detached.verify(message,tx.signatures[0],new PublicKey(r.from).toBytes())||!nacl.sign.detached.verify(expiringJupiterApproval(r),bs58.decode(s.approvalSignature),new PublicKey(r.from).toBytes()))throw Error('Guarded swap signature or transaction mismatch.');
 if(Date.parse(s.signedAt)<Date.parse(r.createdAt)-60000||Date.parse(s.signedAt)>=Date.parse(r.expiresAt)||Date.parse(s.signedAt)>now+60000)throw Error('Invalid guarded swap signing time.');return s;
}
export function expiringJupiterReview(input:unknown,checkExpiry=true,acceptedGuard?:DeadlineGuardIdentity){
 const r=validateExpiringJupiter(input,Date.now(),checkExpiry,acceptedGuard),decoded=inspectDirectJupiterRoute(r.build,solSwapExpected(r)),fees=validateJupiterAncillary(r.build,solSwapExpected(r)),solInput=r.build.inputMint==='So11111111111111111111111111111111111111112';
 return {action:'swap',network:'Solana mainnet',from:r.from,recipient:r.from,jupiterProgram:JUPITER_PROGRAM,raydiumProgram:RAYDIUM_CLMM,programWarning:'Program addresses match the validated route; deployed executable bytes still require online pin verification.',inputBaseUnits:r.build.inAmount,minimumOutputBaseUnits:decoded.minimumOutput,inputIdentity:solInput?'Native SOL via wrapped-SOL mint':'USDC / exact mint',outputIdentity:solInput?'USDC / exact mint':'Native SOL via wrapped-SOL mint and cleanup',inputMint:r.build.inputMint,outputMint:r.build.outputMint,route:'Jupiter route_v2 / Raydium CLMM / '+decoded.pool,amount:formatUnits(r.build.inAmount,solInput?9:6)+' '+(solInput?'SOL':'USDC'),minimumReceived:formatUnits(decoded.minimumOutput,solInput?6:9)+' '+(solInput?'USDC':'SOL'),slippage:r.build.slippageBps/100+'%',maximumFee:formatUnits(BigInt(r.nonceFee)+BigInt(fees.maximumPriorityFee),9)+' SOL',maximumAccountRent:formatUnits(BigInt(r.tokenAccountRent)*BigInt(fees.createdAccounts),9)+' SOL',nonceAccount:r.nonceAccount,nonceValue:r.nonceValue,deadlineUTC:r.expiresAt,deadlineEnforcement:'Solana network clock; expires at or after this time',guardProgram:r.guard.programId,guardSha256:r.guard.sha256,fingerprint:r.fingerprint,warning:'An expired transaction cannot swap, but may still charge its fee and consume the nonce. Before reuse, verify nonce advancement. Cancellation can race the original swap.'};
}
export function isExpiringJupiterShape(v:unknown):boolean{return !!v&&typeof v==='object'&&(('kind' in v&&v.kind==='jupiter-expiring-swap')||('guard' in v&&'unsignedMessage' in v));}
