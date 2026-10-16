import {PublicKey,VersionedTransaction,type Connection,type TokenBalance} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {solSwapExpected,type SolSwapRequest} from './sol-swap-protocol';
import {validateJupiterAncillary} from './jupiter-account-policy';
import type {ExpiringJupiterRequest} from './jupiter-expiring-protocol';
import {solanaEvidence} from './transaction-evidence';
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function lamports(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('Unsafe or missing settlement lamports.');return BigInt(v);}
function balance(list:TokenBalance[],index:number,mint:string,owner:string,decimals:number):bigint|undefined{
 const entries=list.filter(v=>v.accountIndex===index);if(entries.length>1)throw Error('Duplicate settlement token balance.');
 const v=entries[0];if(!v)return undefined;
 if(v.mint!==mint||v.owner!==owner||v.programId!==TOKEN_PROGRAM_ID.toBase58()||v.uiTokenAmount.decimals!==decimals||!/^(0|[1-9][0-9]{0,19})$/.test(v.uiTokenAmount.amount)||BigInt(v.uiTokenAmount.amount)>=2n**64n)throw Error('Settlement token identity or amount differs.');
 return BigInt(v.uiTokenAmount.amount);
}
export async function solSwapDeliveryEvidence(r:SolSwapRequest|ExpiringJupiterRequest,raw:string,hash:string,c:Connection){
 const evidence=await solanaEvidence(hash,raw,c);
 if(evidence.state!=='confirmed')return {...evidence,delivery:'unverified' as const};
 const unavailable={state:'submitted' as const,hash,finality:'finalized',transactionState:'confirmed',delivery:'unverified' as const,message:'Transaction finalized; received amount is not yet verified.'};
 const actual=await c.getTransaction(hash,{commitment:'finalized',maxSupportedTransactionVersion:0});
 if(!actual?.meta)return unavailable;
 const expected=VersionedTransaction.deserialize(Buffer.from(raw,'base64')),meta=actual.meta;
 if(actual.transaction.signatures.length!==1||actual.transaction.signatures[0]!==hash||meta.err!==null||!Buffer.from(actual.transaction.message.serialize()).equals(Buffer.from(expected.message.serialize())))throw Error('Conflicting finalized swap delivery evidence.');
 if(expected.message.version!=='legacy'||!meta.preTokenBalances||!meta.postTokenBalances)return unavailable;
 const keys=expected.message.staticAccountKeys,owner=new PublicKey(r.from),ownerIndex=keys.findIndex(k=>k.equals(owner));
 const solIndex=keys.findIndex(k=>k.equals(getAssociatedTokenAddressSync(new PublicKey(SOL),owner))),usdcIndex=keys.findIndex(k=>k.equals(getAssociatedTokenAddressSync(new PublicKey(USDC),owner)));
 if(ownerIndex!==0||solIndex<0||usdcIndex<0||meta.preBalances.length!==keys.length||meta.postBalances.length!==keys.length)throw Error('Incomplete settlement account mapping.');
 const usdcBefore=balance(meta.preTokenBalances,usdcIndex,USDC,r.from,6),usdcAfter=balance(meta.postTokenBalances,usdcIndex,USDC,r.from,6);
 if(usdcAfter===undefined)return unavailable;
 const fee=lamports(meta.fee),maximumFee=BigInt(r.nonceFee)+BigInt(validateJupiterAncillary(r.build,solSwapExpected(r)).maximumPriorityFee);
 if(fee<BigInt(r.nonceFee)||fee>maximumFee)throw Error('Settled fee exceeds the approved fee bounds.');
 const solBeforeLamports=lamports(meta.preBalances[solIndex]),solBefore=balance(meta.preTokenBalances,solIndex,SOL,r.from,9);
 if(solBeforeLamports>0n&&solBefore===undefined)return unavailable;
 if(solBefore!==undefined&&(solBeforeLamports<BigInt(r.tokenAccountRent)||solBefore>solBeforeLamports-BigInt(r.tokenAccountRent)))throw Error('Invalid pre-swap wrapped SOL accounting.');
 if(solBeforeLamports===0n&&(solBefore!==undefined||!r.build.setupInstructions.some(ix=>ix.accounts[1]?.pubkey===keys[solIndex].toBase58())))return unavailable;
 if(lamports(meta.postBalances[solIndex])!==0n||meta.postTokenBalances.some(v=>v.accountIndex===solIndex))throw Error('Wrapped SOL cleanup was not verified.');
 const usdcPreRent=lamports(meta.preBalances[usdcIndex]),usdcPostRent=lamports(meta.postBalances[usdcIndex]);
 let received:bigint;
 if(r.build.outputMint===USDC){
  // Missing pre-token data is zero only if the account demonstrably did not
  // exist before this exact transaction and creation is in its signed setup.
  if(usdcBefore===undefined&&(usdcPreRent!==0n||!r.build.setupInstructions.some(ix=>ix.accounts[1]?.pubkey===keys[usdcIndex].toBase58())))return unavailable;
  const newUsdcRent=usdcBefore===undefined?BigInt(r.tokenAccountRent):0n;
  if(usdcPostRent-usdcPreRent!==newUsdcRent)throw Error('Unexpected USDC account rent change during settlement.');
  const ownerDebit=lamports(meta.preBalances[ownerIndex])-lamports(meta.postBalances[ownerIndex]);
  if(ownerDebit!==BigInt(r.build.inAmount)+fee+newUsdcRent-solBeforeLamports)throw Error('Settled SOL debit differs from the approved input, fee and account rent.');
  received=usdcAfter-(usdcBefore??0n);
 }else{
  if(usdcBefore===undefined||usdcBefore-usdcAfter!==BigInt(r.build.inAmount))throw Error('Settled USDC debit differs from the approved input.');
  // The canonical transaction closes the SOL ATA to the fee payer. Subtract
  // all pre-existing ATA lamports (rent and old wrapped SOL), so neither is
  // misreported as swap proceeds. Newly paid SOL-ATA rent is returned in-tx.
  received=lamports(meta.postBalances[ownerIndex])-lamports(meta.preBalances[ownerIndex])+fee-solBeforeLamports;
  if(usdcPreRent!==usdcPostRent)throw Error('Unexpected USDC account rent change during settlement.');
 }
 if(received<BigInt(r.build.otherAmountThreshold))throw Error('Verified swap output is below the approved minimum.');
 return {...evidence,delivery:'verified' as const,receivedBaseUnits:received.toString(),outputMint:r.build.outputMint,recipient:r.from,feeLamports:lamports(meta.fee).toString(),slot:actual.slot};
}
