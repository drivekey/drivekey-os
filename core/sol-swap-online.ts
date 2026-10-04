import {solanaEvidence} from './transaction-evidence';
// Read-only preflight. This module has no send/broadcast method.
import {Connection,NonceAccount,PublicKey,SystemProgram,VersionedTransaction,VersionedMessage} from '@solana/web3.js';
import {ACCOUNT_SIZE,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount,unpackMint} from '@solana/spl-token';
import {SOLANA_GENESIS} from './multi-protocol';
import {validateSolSwap,verifySolSwapResponse,solSwapExpected,type SolSwapRequest} from './sol-swap-protocol';
import {validateJupiterAncillary} from './jupiter-account-policy';
import {verifySolSwapPrograms} from './sol-swap-programs';
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function integer(v:number){if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid Solana RPC quantity.');return BigInt(v);}
async function cluster(c:Connection){if(await c.getGenesisHash()!==SOLANA_GENESIS)throw Error('Wrong Solana network.');}
function nonceMatches(info:Awaited<ReturnType<Connection['getAccountInfo']>>,r:SolSwapRequest){
 if(!info||info.executable||!info.owner.equals(SystemProgram.programId)||info.data.length!==80||info.data.readUInt32LE(0)!==1||info.data.readUInt32LE(4)!==1)throw Error('Initialized current-version durable nonce required.');
 const nonce=NonceAccount.fromAccountData(info.data);
 if(nonce.authorizedPubkey.toBase58()!==r.from||nonce.nonce!==r.nonceValue||integer(nonce.feeCalculator.lamportsPerSignature)!==BigInt(r.nonceFee))throw Error('Nonce authority, value or fee changed. Obtain fresh offline approval.');
}
export async function preflightSolSwap(request:unknown,response:unknown,wallet:unknown,c:Connection){
 const r=validateSolSwap(request),s=verifySolSwapResponse(response,r,wallet),tx=VersionedTransaction.deserialize(Buffer.from(s.rawSignedTransaction,'base64'));
 const checked=await checkSolSwapState(r,tx,c,true);
 return {state:'ready',hash:s.transactionHash,broadcastEnabled:false,...checked};
}
// Preparation alone may simulate unsigned bytes. Signed preflight always verifies signatures.
export async function checkPreparedSolSwap(request:unknown,c:Connection){
 const r=validateSolSwap(request),tx=new VersionedTransaction(VersionedMessage.deserialize(Buffer.from(r.unsignedMessage,'base64')));
 return checkSolSwapState(r,tx,c,false);
}
async function checkSolSwapState(r:SolSwapRequest,tx:VersionedTransaction,c:Connection,sigVerify:boolean){
 await cluster(c);
 const programs=await verifySolSwapPrograms(c);
 const owner=new PublicKey(r.from),nonce=new PublicKey(r.nonceAccount),mints=[new PublicKey(SOL),new PublicKey(USDC)],atas=mints.map(m=>getAssociatedTokenAddressSync(m,owner));
 const snapshot=await c.getMultipleAccountsInfoAndContext([owner,nonce,...mints,...atas],{commitment:'confirmed',minContextSlot:programs.slot});
 if(integer(snapshot.context.slot)<BigInt(programs.slot)||snapshot.value.length!==6)throw Error('Stale or incomplete Solana account snapshot.');
 const [payer,nonceInfo,...rest]=snapshot.value;nonceMatches(nonceInfo,r);
 if(!payer||payer.executable||!payer.owner.equals(SystemProgram.programId)||payer.data.length)throw Error('Unsupported fee payer account.');
 const ancillary=validateJupiterAncillary(r.build,solSwapExpected(r));
 for(let i=0;i<2;i++){
  if(!rest[i]||rest[i]!.executable||rest[i]!.data.length!==82)throw Error('Unsupported token mint.');
  const mint=unpackMint(mints[i],rest[i],TOKEN_PROGRAM_ID);
  if(!mint.isInitialized||mint.decimals!==(i===0?9:6)||mint.tlvData.length)throw Error('Token mint identity changed.');
  const info=rest[i+2];
  if(!info){
   const creates=r.build.setupInstructions.some(ix=>ix.accounts[1]?.pubkey===atas[i].toBase58()&&ix.data==='AQ==');
   if(!creates)throw Error('Required token account is missing. Obtain fresh offline approval.');
   if(r.build.inputMint===USDC&&i===1)throw Error('Insufficient USDC balance.');
  }else{
   if(info.executable||info.data.length!==ACCOUNT_SIZE)throw Error('Unsupported token account.');
   const a=unpackAccount(atas[i],info,TOKEN_PROGRAM_ID);
   if(!a.isInitialized||a.isFrozen||a.delegate||a.closeAuthority||a.tlvData.length||!a.owner.equals(owner)||!a.mint.equals(mints[i])||a.isNative!==(i===0))throw Error('Token account identity or authority changed.');
   if(r.build.inputMint===USDC&&i===1&&a.amount<BigInt(r.build.inAmount))throw Error('Insufficient USDC balance.');
  }
 }
 const [rent,fee]=await Promise.all([c.getMinimumBalanceForRentExemption(ACCOUNT_SIZE,'confirmed'),c.getFeeForMessage(tx.message,'confirmed')]);
 if(integer(rent)!==BigInt(r.tokenAccountRent))throw Error('Account rent changed. Obtain fresh offline approval.');
 const maximumFee=BigInt(r.nonceFee)+BigInt(ancillary.maximumPriorityFee);
 if(integer(fee.context.slot)<integer(snapshot.context.slot)||fee.value===null||integer(fee.value)!==maximumFee)throw Error('Network fee changed or nonce is unavailable.');
 const needed=maximumFee+BigInt(r.tokenAccountRent)*BigInt(ancillary.createdAccounts)+(r.build.inputMint===SOL?BigInt(r.build.inAmount):0n);
 if(integer(payer.lamports)<needed)throw Error('Insufficient SOL for input, fees and account rent.');
 // VersionedTransaction overload preserves the exact legacy message. Never replace blockhash.
 const simulation=await c.simulateTransaction(tx,{commitment:'confirmed',sigVerify,replaceRecentBlockhash:false,minContextSlot:snapshot.context.slot});
 if(integer(simulation.context.slot)<integer(snapshot.context.slot))throw Error('Stale Solana simulation.');
 if(simulation.value.err!==null)throw Error('Exact signed swap simulation failed. Reconcile status and obtain fresh approval if changes are needed.');
 if(simulation.value.unitsConsumed===undefined||integer(simulation.value.unitsConsumed)>BigInt(ancillary.maximumComputeUnits))throw Error('Swap simulation exceeded compute policy.');
 const finalNonce=await c.getAccountInfo(nonce,{commitment:'confirmed',minContextSlot:simulation.context.slot});nonceMatches(finalNonce,r);
 await verifySolSwapPrograms(c,simulation.context.slot);
 validateSolSwap(r); // Asynchronous network work cannot extend approval lifetime.
 return {simulationSlot:simulation.context.slot};
}
export async function solSwapStatus(request:unknown,response:unknown,wallet:unknown,c:Connection){
 const s=verifySolSwapResponse(response,request,wallet,Date.now(),false);await cluster(c);
 return solanaEvidence(s.transactionHash,s.rawSignedTransaction,c);
}
