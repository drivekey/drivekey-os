import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { z } from 'zod';

export const JUPITER_PROGRAM='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const EVENT_AUTHORITY='D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
const SOL='So11111111111111111111111111111111111111112';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const key=z.string().max(44).refine(s=>{try{return new PublicKey(s).toBase58()===s;}catch{return false;}});
const units=z.string().regex(/^[1-9][0-9]{0,19}$/).refine(s=>BigInt(s)<2n**64n);
const instruction=z.object({programId:key,accounts:z.array(z.object({pubkey:key,isSigner:z.boolean(),isWritable:z.boolean()}).strict()).max(64),data:z.string().max(1024)}).strict();
const quote=z.object({inputMint:z.enum([SOL,USDC]),outputMint:z.enum([SOL,USDC]),inAmount:units,outAmount:units,otherAmountThreshold:units,slippageBps:z.number().int().min(0).max(100),swapMode:z.literal('ExactIn'),routePlan:z.array(z.object({percent:z.literal(100),bps:z.literal(10000),swapInfo:z.object({ammKey:key,label:z.literal('Raydium CLMM'),inputMint:key,outputMint:key,inAmount:units,outAmount:units})})).length(1),swapInstruction:instruction});

// Fixed layout from the Jupiter-owned on-chain IDL captured at slot 449815178.
// See JUPITER-R21-DECODER.md. This decodes only direct route_v2 / RaydiumClmm.
// It is deliberately not a transaction validator or a signing authorization.
export function decodeDirectJupiterRoute(data:Uint8Array){
 const b=Buffer.from(data);
 if(b.length!==39||b.subarray(0,8).toString('hex')!=='bb64facc31c4af14')throw Error('Unsupported Jupiter instruction layout.');
 const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const amount=view.getBigUint64(8,true),quotedOutput=view.getBigUint64(16,true),slippageBps=b.readUInt16LE(24),platformFeeBps=b.readUInt16LE(26),positiveSlippageBps=b.readUInt16LE(28);
 if(amount===0n||quotedOutput===0n||slippageBps>100||platformFeeBps!==0||positiveSlippageBps!==0)throw Error('Unsupported Jupiter amount, slippage or fee.');
 if(b.readUInt32LE(30)!==1||b[34]!==26||b.readUInt16LE(35)!==10000||b[37]!==0||b[38]!==1)throw Error('Only a single full-allocation Raydium CLMM step can be inspected.');
 return {amount:amount.toString(),quotedOutput:quotedOutput.toString(),slippageBps,platformFeeBps,positiveSlippageBps,route:'RaydiumClmm' as const};
}

export function inspectDirectJupiterRoute(input:unknown,expected:{from:string;inputMint:string;amount:string;slippageBps:number}){
 const q=quote.parse(input),owner=new PublicKey(expected.from);
 if(!PublicKey.isOnCurve(owner.toBytes())||q.inputMint===q.outputMint||q.inputMint!==expected.inputMint||q.inAmount!==expected.amount||q.slippageBps!==expected.slippageBps)throw Error('Jupiter quote does not match the requested wallet trade.');
 const step=q.routePlan[0].swapInfo;
 if(step.inputMint!==q.inputMint||step.outputMint!==q.outputMint||step.inAmount!==q.inAmount||step.outAmount!==q.outAmount)throw Error('Route metadata does not match the quoted trade.');
 const ix=q.swapInstruction,data=Buffer.from(ix.data,'base64');
 if(data.toString('base64')!==ix.data||ix.programId!==JUPITER_PROGRAM)throw Error('Unsupported Jupiter encoding or program.');
 const decoded=decodeDirectJupiterRoute(data);
 if(decoded.amount!==q.inAmount||decoded.quotedOutput!==q.outAmount||decoded.slippageBps!==q.slippageBps||BigInt(q.otherAmountThreshold)>BigInt(q.outAmount))throw Error('Displayed quote differs from instruction bytes.');
 // Jupiter route_v2 rounds the protected minimum up. The one-base-unit
 // boundary was checked against the captured deployed program in LiteSVM.
 const minimumOutput=(BigInt(decoded.quotedOutput)*BigInt(10000-decoded.slippageBps)+9999n)/10000n;
 if(q.otherAmountThreshold!==minimumOutput.toString())throw Error('Displayed minimum output differs from the instruction-enforced minimum.');
 const ata=(mint:string)=>getAssociatedTokenAddressSync(new PublicKey(mint),owner).toBase58();
 const expectedAccounts=[
  [owner.toBase58(),true,false],[ata(q.inputMint),false,true],[ata(q.outputMint),false,true],
  [q.inputMint,false,false],[q.outputMint,false,false],[TOKEN_PROGRAM_ID.toBase58(),false,false],
  [TOKEN_PROGRAM_ID.toBase58(),false,false],[JUPITER_PROGRAM,false,false],[EVENT_AUTHORITY,false,false],[JUPITER_PROGRAM,false,false],
 ];
 if(ix.accounts.length<11||expectedAccounts.some(([pubkey,isSigner,isWritable],i)=>{const a=ix.accounts[i];return a.pubkey!==pubkey||a.isSigner!==isSigner||a.isWritable!==isWritable;}))throw Error('Jupiter wallet, recipient or token accounts differ from the reviewed trade.');
 return {state:'decoded-unverified' as const,signingEnabled:false as const,...decoded,minimumOutput:minimumOutput.toString(),recipient:owner.toBase58(),inputMint:q.inputMint,outputMint:q.outputMint,pool:step.ammKey,apiMinimumOutput:q.otherAmountThreshold,missing:['Complete static transaction/account policy validation','Versioned offline-signer integration and acceptance']};
}
