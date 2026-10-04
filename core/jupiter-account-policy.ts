import { ComputeBudgetProgram,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction,createCloseAccountInstruction,createSyncNativeInstruction,getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { z } from 'zod';
import { inspectDirectJupiterRoute,JUPITER_PROGRAM } from './jupiter-route-inspection';
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const RAYDIUM_CLMM='CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
// Immutable identity fields observed at finalized slot 449817220; see pool-identities.json.
const POOLS:Record<string,{config:string;observation:string;spacing:number}>={
 '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj':{config:'9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x',observation:'3MsJXVvievxAbsMsaT6TS4i6oMitD9jazucuq3X234tC',spacing:1},
 '87Dia7JixTXFrXs7i5YHT1Z3dJFkd9KdaWquNcPsGPyT':{config:'DrdecJVzkaRsf1TQu1g7iFncaokikVTHqpzPjenjRySY',observation:'6JKrD2JYLxak4LUnQZKnuBfj2UNsgug4iqAN973PqxBM',spacing:10},
};
const meta=z.object({pubkey:z.string().max(44),isSigner:z.boolean(),isWritable:z.boolean()}).strict();
const instruction=z.object({programId:z.string().max(44),accounts:z.array(meta).max(64),data:z.string().max(1024)}).strict();
type ApiInstruction=z.infer<typeof instruction>;
type Expected={from:string;inputMint:string;amount:string;slippageBps:number};
function encoded(ix:TransactionInstruction):ApiInstruction{return {programId:ix.programId.toBase58(),accounts:ix.keys.map(k=>({pubkey:k.pubkey.toBase58(),isSigner:k.isSigner,isWritable:k.isWritable})),data:ix.data.toString('base64')};}
function equal(a:ApiInstruction,b:ApiInstruction){return a.programId===b.programId&&a.data===b.data&&a.accounts.length===b.accounts.length&&a.accounts.every((m,i)=>m.pubkey===b.accounts[i].pubkey&&m.isSigner===b.accounts[i].isSigner&&m.isWritable===b.accounts[i].isWritable);}

// Ancillary effects are reconstructed byte-for-byte; no generic instruction allowlist.
export function validateJupiterAncillary(input:unknown,expected:Expected){
 inspectDirectJupiterRoute(input,expected);
 const q=z.object({setupInstructions:z.array(instruction).max(4),cleanupInstruction:instruction,computeBudgetInstructions:z.array(instruction).max(1),otherInstructions:z.array(instruction).length(0),tipInstruction:z.null()}).parse(input);
 const owner=new PublicKey(expected.from),sol=new PublicKey(SOL),usdc=new PublicKey(USDC),solAta=getAssociatedTokenAddressSync(sol,owner),usdcAta=getAssociatedTokenAddressSync(usdc,owner);
 const solCreate=encoded(createAssociatedTokenAccountIdempotentInstruction(owner,solAta,owner,sol));
 const usdcCreate=encoded(createAssociatedTokenAccountIdempotentInstruction(owner,usdcAta,owner,usdc));
 const wrap=[encoded(SystemProgram.transfer({fromPubkey:owner,toPubkey:solAta,lamports:BigInt(expected.amount)})),encoded(createSyncNativeInstruction(solAta))];
 const candidates:ApiInstruction[][]=[];
 for(const createSol of [false,true])for(const createUsdc of [false,true]){
  if(expected.inputMint===SOL)candidates.push([...(createSol?[solCreate]:[]),...wrap,...(createUsdc?[usdcCreate]:[])]);
  else candidates.push([...(createUsdc?[usdcCreate]:[]),...(createSol?[solCreate]:[])]);
 }
 if(!candidates.some(c=>c.length===q.setupInstructions.length&&c.every((ix,i)=>equal(ix,q.setupInstructions[i]))))throw Error('Unsupported setup: wrapping and account creation must match the wallet and exact input.');
 if(!equal(q.cleanupInstruction,encoded(createCloseAccountInstruction(solAta,owner,owner))))throw Error('Cleanup must return wrapped SOL and rent to the signing wallet.');
 let microLamports=0n;
 if(q.computeBudgetInstructions.length){const ix=q.computeBudgetInstructions[0],data=Buffer.from(ix.data,'base64');if(data.length!==9||data[0]!==3||data.toString('base64')!==ix.data)throw Error('Unsupported compute-budget instruction.');microLamports=new DataView(data.buffer,data.byteOffset,data.byteLength).getBigUint64(1,true);if(!equal(ix,encoded(ComputeBudgetProgram.setComputeUnitPrice({microLamports}))))throw Error('Unexpected compute-budget accounts.');}
 const maximumPriorityFee=(1400000n*microLamports+999999n)/1000000n;
 if(maximumPriorityFee>1000000n)throw Error('Priority fee exceeds the release policy.');
 return {maximumComputeUnits:1400000,microLamports:microLamports.toString(),maximumPriorityFee:maximumPriorityFee.toString(),createdAccounts:q.setupInstructions.filter(ix=>ix.programId===solCreate.programId).length,cleanupRecipient:owner.toBase58()};
}

// Tick starts are untrusted context: every claimed start must derive the exact account PDA.
export function validateRaydiumRouteAccounts(input:unknown,expected:Expected,tickStarts:Record<string,number>){
 const decoded=inspectDirectJupiterRoute(input,expected),policy=POOLS[decoded.pool];
 if(!policy)throw Error('Raydium pool is not pinned for this release.');
 const pool=new PublicKey(decoded.pool),program=new PublicKey(RAYDIUM_CLMM),owner=new PublicKey(expected.from);
 const derive=(seed:string,...keys:PublicKey[])=>PublicKey.findProgramAddressSync([Buffer.from(seed),...keys.map(k=>k.toBuffer())],program)[0].toBase58();
 if(derive('pool',new PublicKey(policy.config),new PublicKey(SOL),new PublicKey(USDC))!==decoded.pool)throw Error('Pinned pool identity mismatch.');
 const q=z.object({swapInstruction:instruction}).parse(input),accounts=q.swapInstruction.accounts;
 if(accounts.length<22||accounts.length>26)throw Error('Unexpected Raydium account count.');
 const ata=(mint:string)=>getAssociatedTokenAddressSync(new PublicKey(mint),owner).toBase58();
 const fixed:[string,boolean][]=[[RAYDIUM_CLMM,false],[expected.from,false],[policy.config,false],[decoded.pool,true],[ata(decoded.inputMint),true],[ata(decoded.outputMint),true],[derive('pool_vault',pool,new PublicKey(decoded.inputMint)),true],[derive('pool_vault',pool,new PublicKey(decoded.outputMint)),true],[policy.observation,true],[TOKEN_PROGRAM_ID.toBase58(),false]];
 for(let i=0;i<fixed.length;i++){const a=accounts[i+10];if(a.pubkey!==fixed[i][0]||a.isWritable!==fixed[i][1]||a.isSigner)throw Error('Raydium program, pool, vault or authority mismatch.');}
 const last=accounts.at(-1)!;if(last.pubkey!==JUPITER_PROGRAM||last.isWritable||last.isSigner)throw Error('Unexpected trailing Jupiter account.');
 const bitmap=derive('pool_tick_array_bitmap_extension',pool),seen=new Set<string>();let ticks=0;
 for(const a of accounts.slice(20,-1)){
  if(!a.isWritable||a.isSigner||seen.has(a.pubkey))throw Error('Unexpected tick account privilege or duplicate.');seen.add(a.pubkey);
  if(a.pubkey===bitmap){if(ticks===0)throw Error('First remaining account must be a tick array.');continue;}
  const start=tickStarts[a.pubkey];if(!Number.isInteger(start)||start<Math.floor(-443636/(60*policy.spacing))*60*policy.spacing||start>443636||start%(60*policy.spacing)!==0)throw Error('Missing or invalid tick-array start.');
  const bytes=Buffer.alloc(4);bytes.writeInt32BE(start);
  const derived=PublicKey.findProgramAddressSync([Buffer.from('tick_array'),pool.toBuffer(),bytes],program)[0].toBase58();
  if(derived!==a.pubkey)throw Error('Tick array does not belong to the pinned pool.');ticks++;
 }
 if(ticks<1||ticks>4)throw Error('Unsupported tick-array count.');
 return {pool:decoded.pool,program:RAYDIUM_CLMM,tickArrays:ticks,config:policy.config,observation:policy.observation,signingEnabled:false as const};
}

// Internal preparation primitive, not an enabled signing flow. Every address is static.
// Provider lookup-table mappings and short-lived blockhashes are deliberately unused.
export function buildJupiterLegacyMessage(input:unknown,expected:Expected,tickStarts:Record<string,number>,nonceAccount:string,nonceValue:string){
 const ancillary=validateJupiterAncillary(input,expected);
 validateRaydiumRouteAccounts(input,expected,tickStarts);
 const q=z.object({setupInstructions:z.array(instruction),swapInstruction:instruction,cleanupInstruction:instruction,computeBudgetInstructions:z.array(instruction)}).parse(input);
 const owner=new PublicKey(expected.from),nonce=new PublicKey(nonceAccount),value=new PublicKey(nonceValue);
 const all=[...q.setupInstructions,q.swapInstruction,q.cleanupInstruction];
 if(all.some(ix=>ix.programId===nonceAccount||ix.accounts.some(a=>a.pubkey===nonceAccount)))throw Error('Nonce account aliases a swap account.');
 const convert=(ix:ApiInstruction)=>new TransactionInstruction({programId:new PublicKey(ix.programId),keys:ix.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data:Buffer.from(ix.data,'base64')});
 const instructions=[SystemProgram.nonceAdvance({noncePubkey:nonce,authorizedPubkey:owner}),ComputeBudgetProgram.setComputeUnitLimit({units:ancillary.maximumComputeUnits}),...q.computeBudgetInstructions.map(convert),...all.map(convert)];
 const message=new TransactionMessage({payerKey:owner,recentBlockhash:value.toBase58(),instructions}).compileToLegacyMessage();
 if(message.header.numRequiredSignatures!==1||new VersionedTransaction(message).serialize().length>1232)throw Error('Swap exceeds the static-account transaction policy.');
 return message;
}
