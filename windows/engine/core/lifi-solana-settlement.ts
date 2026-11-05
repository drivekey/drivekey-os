import {PublicKey,SystemProgram} from '@solana/web3.js';
import {getAssociatedTokenAddressSync} from '@solana/spl-token';
import bs58 from 'bs58';
import {CHAINS} from './payment-intent';
import {inspectLifiSolana} from './lifi-solana-inspect';
import {LifiSolanaIntent,verifyLifiSolanaResponse} from './lifi-solana-intent';
const safe=(v:any)=>{if(!Number.isSafeInteger(v)||v<0)throw Error('Unsafe finalized Solana amount.');return BigInt(v);};
export function lifiSolanaSettlement(r:LifiSolanaIntent,s:any,receipt:any){
 verifyLifiSolanaResponse(s,r,{deviceId:r.deviceId,solanaAddress:r.from},Date.now(),false);const v=inspectLifiSolana(r.unsignedTransaction,r.lookupTables,r),m=receipt?.meta,keys=v.keys.map(k=>k.toBase58()),index=(a:string)=>keys.indexOf(a);
 if(receipt?.transaction?.[0]!==s.rawSignedTransaction||receipt.transaction[1]!=='base64'||m?.err!==null||!Array.isArray(m.preBalances)||!Array.isArray(m.postBalances)||m.preBalances.length!==keys.length||m.postBalances.length!==keys.length)throw Error('Finalized Solana swap bytes or metadata differ.');safe(receipt.slot);const fee=safe(m.fee);if(fee>BigInt(r.maximumFee))throw Error('Actual Solana swap fee exceeds approval.');
 const loaded=v.tx.message.version===0?v.tx.message.addressTableLookups:[],writable=loaded.reduce((n,l)=>n+l.writableIndexes.length,0),staticLength=v.tx.message.staticAccountKeys.length;
 if(JSON.stringify(m.loadedAddresses?.writable||[])!==JSON.stringify(keys.slice(staticLength,staticLength+writable))||JSON.stringify(m.loadedAddresses?.readonly||[])!==JSON.stringify(keys.slice(staticLength+writable)))throw Error('Finalized lookup addresses differ from reviewed snapshots.');
 const usdc=getAssociatedTokenAddressSync(new PublicKey(CHAINS.solana.usdc),new PublicKey(r.from)).toBase58(),tokenIndex=index(usdc),token=(entries:any[],optional=false)=>{const b=entries?.find(e=>e.accountIndex===tokenIndex);if(!b&&optional)return 0n;if(!b||b.owner!==r.from||b.mint!==CHAINS.solana.usdc||b.uiTokenAmount?.decimals!==6||!/^(0|[1-9][0-9]*)$/.test(b.uiTokenAmount.amount))throw Error('Finalized USDC ownership, mint or decimals differ.');return BigInt(b.uiTokenAmount.amount);};
 const tokenDelta=token(m.postTokenBalances)-token(m.preTokenBalances,r.tokenIn==='SOL'),ataDeltas=v.review.createdAccounts.reduce((n,address)=>{const i=index(address);return n+safe(m.postBalances[i])-safe(m.preBalances[i]);},0n),sourceDebit=safe(m.preBalances[0])-safe(m.postBalances[0]);let output:bigint;
 if(r.tokenIn==='SOL'){output=tokenDelta;if(sourceDebit!==BigInt(r.amount)+fee+ataDeltas)throw Error('Solana native input debit differs from amount, fee and account funding.');}
 else{if(tokenDelta!==-BigInt(r.amount))throw Error('Solana USDC input debit differs.');output=fee+ataDeltas-sourceDebit;}
 if(output<BigInt(r.minimumOutput))throw Error('Independent Solana destination credit below minimum.');
 const rentByAccount=new Map<string,bigint>();if(!Array.isArray(m.innerInstructions))throw Error('Actual Solana rent metadata unavailable.');
 for(const group of m.innerInstructions)for(const instruction of group.instructions||[]){if(keys[instruction.programIdIndex]!==SystemProgram.programId.toBase58()||!Array.isArray(instruction.accounts)||instruction.accounts.length<2||keys[instruction.accounts[0]]!==r.from)continue;const target=keys[instruction.accounts[1]];if(!v.review.createdAccounts.includes(target))throw Error('Unexpected source-funded account in swap.');const data=Buffer.from(bs58.decode(instruction.data)),opcode=data.length>=4?data.readUInt32LE(0):-1;if(![0,2].includes(opcode)||data.length<(opcode===0?52:12))throw Error('Unreviewed Solana account-funding operation.');rentByAccount.set(target,(rentByAccount.get(target)||0n)+data.readBigUInt64LE(4));}
 let rent=0n;for(const address of v.review.createdAccounts){const i=index(address),before=safe(m.preBalances[i]),after=safe(m.postBalances[i]),charged=rentByAccount.get(address)||0n;if((before===0n&&charged===0n)||after-before>charged)throw Error('Account rent cannot be independently reconciled.');rent+=charged;}
 if(rent>BigInt(r.accountRent))throw Error('Actual gross account rent exceeds approval.');return {output:output.toString(),actualFeeBaseUnits:fee.toString(),actualRentBaseUnits:rent.toString(),recipient:r.recipient,asset:r.tokenOut,slot:receipt.slot,providerStatusUsedAsSettlement:false};
}
