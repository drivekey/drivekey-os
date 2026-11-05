import {verifyJupiterSharedAccounts} from './jupiter-shared-accounts';
import {randomUUID} from 'node:crypto';
import {VersionedTransaction,AddressLookupTableAccount,PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {z} from 'zod';
import {OnlineAdapter} from './adapter';
import {LifiQuotes} from './providers';
import {verifySolanaPrograms} from './solana-programs';
import {CHAINS} from '../engine/core/payment-intent';
import {SOLANA_LIFI,inspectLifiSolana,resolveLifiSolana,LookupSnapshot} from '../engine/core/lifi-solana-inspect';
import {LifiSolanaIntent,lifiSolanaFingerprint,validateLifiSolana,verifyLifiSolanaResponse} from '../engine/core/lifi-solana-intent';
import {lifiSolanaSettlement} from '../engine/core/lifi-solana-settlement';
const {BorshInstructionCoder}=require('@coral-xyz/anchor/dist/cjs/coder/borsh/instruction.js'),coder=new BorshInstructionCoder(require('../vendor/jupiter/idl.json'));
const safe=(v:any)=>{if(!Number.isSafeInteger(v)||v<0)throw Error('Malformed Solana RPC integer.');return v as number;};
export class LifiSolanaAdapter{
 constructor(readonly adapter:OnlineAdapter,readonly quotes=new LifiQuotes()){}
 rpc(m:string,p:any[]){return this.adapter.rpc('solana',m,p);}
 async lookupTables(tx:VersionedTransaction){const snapshots:LookupSnapshot[]=[];for(const l of (tx.message as any).addressTableLookups){const address=l.accountKey.toBase58(),v=await this.rpc('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);if(v.value?.owner!==SOLANA_LIFI.lookupOwner)throw Error('Lookup table owner mismatch.');snapshots.push({address,owner:v.value.owner,dataBase64:v.value.data[0],contextSlot:safe(v.context.slot)});}return snapshots;}
 async accountState(r:LifiSolanaIntent){const v=inspectLifiSolana(r.unsignedTransaction,r.lookupTables,r),keys=v.review.createdAccounts,infos=await this.rpc('getMultipleAccounts',[keys,{encoding:'jsonParsed',commitment:'confirmed'}]),rent=BigInt(safe(await this.rpc('getMinimumBalanceForRentExemption',[165])));let required=0n;
  for(let i=0;i<keys.length;i++){const account=infos.value[i];if(!account){required+=rent;continue;}const p=account.data?.parsed?.info;if(account.owner!==TOKEN_PROGRAM_ID.toBase58()||account.data.parsed.type!=='account'||p.owner!==r.from||p.state!=='initialized'||getAssociatedTokenAddressSync(new PublicKey(p.mint),new PublicKey(r.from)).toBase58()!==keys[i]||p.delegate||p.closeAuthority&&p.closeAuthority!==r.from)throw Error('Existing ATA ownership, mint or authority differs.');if(p.mint===NATIVE_MINT.toBase58()&&p.tokenAmount?.amount!=='0')throw Error('Pre-existing wrapped SOL must be empty before swap.');}
  const mint=await this.rpc('getAccountInfo',[CHAINS.solana.usdc,{encoding:'jsonParsed',commitment:'confirmed'}]);if(mint.value?.owner!==TOKEN_PROGRAM_ID.toBase58()||mint.value.data?.parsed?.type!=='mint'||mint.value.data.parsed.info.decimals!==6)throw Error('Canonical Solana USDC decimals changed.');
  await verifyJupiterSharedAccounts(this.adapter,v.review.sharedAccounts);return required;
 }
 async prepare(input:unknown,w:any,now=Date.now()){const r=await this.prepareUnsigned(input,w,now);await this.preflight(r);return r;}
 async prepareUnsigned(input:unknown,w:any,now=Date.now()){
  const p=z.object({tokenIn:z.enum(['SOL','USDC']),amount:z.string().regex(/^[1-9][0-9]*$/).max(38),recipient:z.string(),slippageBps:z.number().int().min(1).max(100)}).strict().parse(input);await this.adapter.identity('solana');if(p.recipient!==w.solanaAddress)throw Error('This finite Solana swap profile returns to its controlled source wallet.');
  const result=await this.quotes.quote({fromChain:'solana',toChain:'solana',fromAsset:p.tokenIn,toAsset:p.tokenIn==='SOL'?'USDC':'SOL',amount:p.amount,fromAddress:w.solanaAddress,toAddress:p.recipient,slippageBps:p.slippageBps,exchange:'jupiter'}),q:any=result.quote,serialized=q.transactionRequest?.data;if(typeof serialized!=='string')throw Error('Missing Solana quote transaction.');const tx=VersionedTransaction.deserialize(Buffer.from(serialized,'base64')),snapshots=await this.lookupTables(tx),resolved=resolveLifiSolana(serialized,snapshots),jup=resolved.message.instructions.find(i=>i.programId.toBase58()===SOLANA_LIFI.jupiter),decoded=jup?coder.decode(jup.data):null;if(!decoded||!['route_v2','shared_accounts_route_v2'].includes(decoded.name))throw Error('Unsupported Jupiter instruction variant.');
  const d=decoded.data,quotedOutput=d.quoted_out_amount.toString(10),minimumOutput=(BigInt(quotedOutput)*BigInt(10000-d.slippage_bps)/10000n).toString();if(q.estimate.toAmount!==quotedOutput)throw Error('Provider quote differs from encoded Jupiter output.');await verifySolanaPrograms(this.adapter,resolved.keys.map(k=>k.toBase58()));const slot=safe(await this.rpc('getSlot',[{commitment:'confirmed'}])),latest=(await this.rpc('getLatestBlockhash',[{commitment:'confirmed',minContextSlot:slot}])).value;tx.message.recentBlockhash=latest.blockhash;
  const epoch=await this.rpc('getEpochInfo',[{commitment:'confirmed'}]),ixs=resolved.message.instructions,limit=ixs[0].data.readUInt32LE(1),price=ixs[1].data.readBigUInt64LE(1),r:any={version:11,action:'swap',provider:'lifi-jupiter',chain:'solana',network:'solana',requestId:randomUUID(),deviceId:w.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from:w.solanaAddress,recipient:p.recipient,tokenIn:p.tokenIn,tokenOut:p.tokenIn==='SOL'?'USDC':'SOL',amount:p.amount,quotedOutput,minimumOutput,slippageBps:p.slippageBps,protocolFee:(BigInt(p.amount)*25n/10000n).toString(),maximumFee:(5000n+(BigInt(limit)*price+999999n)/1000000n).toString(),accountRent:'0',blockhash:latest.blockhash,lastValidBlockHeight:safe(latest.lastValidBlockHeight),epoch:safe(epoch.epoch),lookupTables:snapshots,unsignedTransaction:Buffer.from(tx.serialize()).toString('base64')};
  r.fingerprint=lifiSolanaFingerprint(r);validateLifiSolana(r,now);r.accountRent=(await this.accountState(r)).toString();r.fingerprint=lifiSolanaFingerprint(r);validateLifiSolana(r,now);return r as LifiSolanaIntent;
 }
 async preflight(input:unknown){const r=validateLifiSolana(input),v=inspectLifiSolana(r.unsignedTransaction,r.lookupTables,r);await this.adapter.identity('solana');
  // These are independent reads of the same immutable intent. Bound concurrency
  // and drain every task before returning, including when one check rejects.
  const checks:Array<()=>Promise<void>>=[
   async()=>{const current=await this.lookupTables(v.tx);if(current.some((t,i)=>t.dataBase64!==r.lookupTables[i].dataBase64||t.owner!==r.lookupTables[i].owner))throw Error('Solana lookup table changed after review.');},
   async()=>{if((await this.rpc('isBlockhashValid',[r.blockhash,{commitment:'confirmed'}])).value!==true||safe(await this.rpc('getBlockHeight',[{commitment:'confirmed'}]))>r.lastValidBlockHeight)throw Error('Solana swap blockhash expired.');if(safe((await this.rpc('getEpochInfo',[{commitment:'confirmed'}])).epoch)!==r.epoch)throw Error('Solana tracker epoch changed.');},
   async()=>{await verifySolanaPrograms(this.adapter,v.keys.map(k=>k.toBase58()));},
   async()=>{const b=await this.adapter.balance('solana',r.from,r.tokenIn);if(BigInt(b.amount)<BigInt(r.amount)||BigInt(b.native)<BigInt(r.maximumFee)+BigInt(r.accountRent)+(r.tokenIn==='SOL'?BigInt(r.amount):0n))throw Error('Insufficient Solana funds, rent or source authority.');},
   async()=>{if(await this.accountState(r)>BigInt(r.accountRent))throw Error('Insufficient Solana funds, rent or source authority.');},
   async()=>{const fee=(await this.rpc('getFeeForMessage',[Buffer.from(v.tx.message.serialize()).toString('base64'),{commitment:'confirmed'}])).value;if(BigInt(safe(fee))>BigInt(r.maximumFee))throw Error('Solana swap network fee increased.');},
   async()=>{const simulation=await this.rpc('simulateTransaction',[r.unsignedTransaction,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'}]);if(simulation.value?.err!==null)throw Error('Exact Solana swap simulation failed.');}
  ];
  let next=0;const results:PromiseSettledResult<void>[]=new Array(checks.length);
  await Promise.all(Array.from({length:Math.min(3,checks.length)},async()=>{for(;;){const index=next++;if(index>=checks.length)return;try{await checks[index]();results[index]={status:'fulfilled',value:undefined};}catch(reason){results[index]={status:'rejected',reason};}}}));
  for(const result of results)if(result.status==='rejected')throw result.reason;
  // The independent work above may take time; recheck the original expiry and
  // exact blockhash immediately before permitting signing or submission.
  validateLifiSolana(r);
  if((await this.rpc('isBlockhashValid',[r.blockhash,{commitment:'confirmed'}])).value!==true||safe(await this.rpc('getBlockHeight',[{commitment:'confirmed'}]))>r.lastValidBlockHeight)throw Error('Solana swap blockhash expired.');
 }
 async broadcast(r:LifiSolanaIntent,s:any){verifyLifiSolanaResponse(s,r,{deviceId:r.deviceId,solanaAddress:r.from});await this.preflight(r);const signature=await this.rpc('sendTransaction',[s.rawSignedTransaction,{encoding:'base64',skipPreflight:false,maxRetries:0}]);if(signature!==s.transactionHash)throw Error('Uncertain Solana swap broadcast; reconcile approved signature only.');return signature;}
 async reconcile(r:LifiSolanaIntent,s:any){verifyLifiSolanaResponse(s,r,{deviceId:r.deviceId,solanaAddress:r.from},Date.now(),false);await this.adapter.identity('solana');const status=(await this.rpc('getSignatureStatuses',[[s.transactionHash],{searchTransactionHistory:true}])).value?.[0];if(status?.err)return {state:'failed',receipt:status};if(status?.confirmationStatus==='finalized'){const receipt=await this.rpc('getTransaction',[s.transactionHash,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);if(receipt?.slot!==status.slot)throw Error('Finalized Solana slot differs from status.');return {state:'confirmed',receipt,...lifiSolanaSettlement(r,s,receipt)};}if(status)return {state:'pending',receipt:status};return {state:safe(await this.rpc('getBlockHeight',[{commitment:'finalized'}]))>r.lastValidBlockHeight?'expired-unresolved':'uncertain',reason:'Reconcile exact signature; no automatic rebroadcast or replacement.'};}
}

export {verifyJupiterSharedAccounts};
