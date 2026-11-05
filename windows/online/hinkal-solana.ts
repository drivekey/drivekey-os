import {assertHinkalSolanaAppendCursor} from '../engine/core/hinkal-solana-cursor';
import {randomUUID} from 'node:crypto';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {OnlineAdapter} from './adapter';
import {verifySolanaPrograms} from './solana-programs';
import {CHAINS} from '../engine/core/payment-intent';
import {HINKAL_SOLANA,HinkalSolanaIntent,inspectHinkalSolana,validateHinkalSolana,hinkalSolanaFingerprint,verifyHinkalSolanaResponse} from '../engine/core/hinkal-solana-intent';
import {hinkalSolanaSettlement} from '../engine/core/hinkal-solana-settlement';
const idl=require('../vendor/hinkal/solana-idl.json'),{BorshAccountsCoder}=require('@coral-xyz/anchor'),coder=new BorshAccountsCoder(idl),safe=(n:any)=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Malformed Solana RPC integer.');return n;};
export class HinkalSolanaAdapter{
 constructor(readonly adapter:OnlineAdapter){}rpc(m:string,p:any[]){return this.adapter.rpc('solana',m,p);}
 async accountState(r:Parameters<typeof inspectHinkalSolana>[0]){const v=inspectHinkalSolana(r),addresses=[v.accounts.storage,v.accounts.vault,v.accounts.merkle,v.accounts.root,...(v.accounts.sourceAta?[v.accounts.sourceAta,v.accounts.vaultAta!]:[])],infos=await this.rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);if(infos.value?.length!==addresses.length||infos.value.slice(0,4).some((a:any,i:number)=>a?.owner!==(i===1?'11111111111111111111111111111111':HINKAL_SOLANA.program)||i===1&&a.space!==0))throw Error('Hinkal pool state owner differs.');const merkle=coder.decode('Merkle',Buffer.from((await this.rpc('getAccountInfo',[v.accounts.merkle,{encoding:'base64',commitment:'confirmed'}])).value.data[0],'base64')),cursor=BigInt('0x'+Buffer.from(merkle.m_index).toString('hex'));assertHinkalSolanaAppendCursor(r.merkleMIndex,cursor.toString(),1);
  const rootSpace=safe(infos.value[3].space);if(rootSpace>10485728)throw Error('Hinkal root bucket size exceeds reviewed bound.');const rentMinimum=BigInt(safe(await this.rpc('getMinimumBalanceForRentExemption',[rootSpace+32]))),rootRent=rentMinimum>BigInt(safe(infos.value[3].lamports))?rentMinimum-BigInt(infos.value[3].lamports):0n;
  if(r.asset==='SOL')return rootRent;const parsed=await this.rpc('getMultipleAccounts',[[v.accounts.sourceAta,v.accounts.vaultAta,CHAINS.solana.usdc],{encoding:'jsonParsed',commitment:'confirmed'}]);for(const [i,owner]of [[0,r.from],[1,v.accounts.vault]] as const){const a=parsed.value[i],p=a?.data?.parsed?.info;if(!a&&i===1)continue;if(a?.owner!==TOKEN_PROGRAM_ID.toBase58()||a.data.parsed.type!=='account'||p.owner!==owner||p.mint!==CHAINS.solana.usdc||p.state!=='initialized'||p.delegate||p.closeAuthority&&p.closeAuthority!==owner)throw Error('Hinkal token account ownership or authority differs.');}const mint=parsed.value[2];if(mint?.owner!==TOKEN_PROGRAM_ID.toBase58()||mint.data?.parsed?.type!=='mint'||mint.data.parsed.info.decimals!==6)throw Error('Hinkal canonical USDC mint differs.');return rootRent+(parsed.value[1]?0n:BigInt(safe(await this.rpc('getMinimumBalanceForRentExemption',[165]))));
 }
 async prepare(plan:any,w:any,now=Date.now()){
  if(plan.from!==w.solanaAddress||plan.recipient!==w.solanaAddress||plan.viewOnly!==true||plan.blockchainTransactionSigned!==false||plan.submitted!==false)throw Error('Expected an unsigned view-only Hinkal deposit plan.');
  const {from,recipient,asset,amount,merkleMIndex,blockhash,unsignedTransaction}=plan,deviceId=w.deviceId;
  const draft={from,recipient,asset,amount,merkleMIndex,blockhash,unsignedTransaction};
  const {tx,keys}=inspectHinkalSolana(draft);
  // Do slow reads while this is still an unsigned plan. The returned intent
  // must pass the full preflight again against its exact fresh message.
  await this.adapter.identity('solana');
  const accountRent=(await this.accountState(draft)).toString();
  await this.verifyPrograms(keys.map(key=>key.toBase58()));
  const latest=(await this.rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value;
  tx.message.recentBlockhash=latest.blockhash;
  const fee=(await this.rpc('getFeeForMessage',[Buffer.from(tx.message.serialize()).toString('base64'),{commitment:'confirmed'}])).value;
  const r:HinkalSolanaIntent={version:14,provider:'hinkal',action:'hinkal-deposit',network:'solana',chain:'solana',requestId:randomUUID(),deviceId,
   createdAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),from,recipient,asset,amount,maximumFee:String(safe(fee)),accountRent,
   blockhash:latest.blockhash,lastValidBlockHeight:safe(latest.lastValidBlockHeight),merkleMIndex,programDataSha256:HINKAL_SOLANA.pin.programDataSha256,
   unsignedTransaction:Buffer.from(tx.serialize()).toString('base64'),fingerprint:''};
  r.fingerprint=hinkalSolanaFingerprint(r);
  await this.preflight(r);
  return r;
 }
 private async verifyPrograms(keys:string[]){
  const verified=await verifySolanaPrograms(this.adapter,keys,[HINKAL_SOLANA.pin]);
  if(!verified.includes(HINKAL_SOLANA.program))throw Error('Hinkal Solana executable was not verified.');
 }
 async preflight(input:unknown){const r=validateHinkalSolana(input),v=inspectHinkalSolana(r);await this.adapter.identity('solana');if((await this.rpc('isBlockhashValid',[r.blockhash,{commitment:'confirmed'}])).value!==true||safe(await this.rpc('getBlockHeight',[{commitment:'confirmed'}]))>r.lastValidBlockHeight)throw Error('Hinkal Solana blockhash expired.');if(await this.accountState(r)>BigInt(r.accountRent))throw Error('Hinkal account rent increased.');
  await this.verifyPrograms(v.keys.map(k=>k.toBase58()));
  const b=await this.adapter.balance('solana',r.from,r.asset);if(BigInt(b.amount)<BigInt(r.amount)||BigInt(b.native)<BigInt(r.maximumFee)+BigInt(r.accountRent)+(r.asset==='SOL'?BigInt(r.amount):0n))throw Error('Insufficient Hinkal deposit balance or fee reserve.');const fee=(await this.rpc('getFeeForMessage',[Buffer.from(v.tx.message.serialize()).toString('base64'),{commitment:'confirmed'}])).value;if(BigInt(safe(fee))>BigInt(r.maximumFee))throw Error('Hinkal Solana fee increased.');const simulation=await this.rpc('simulateTransaction',[r.unsignedTransaction,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'}]);if(simulation.value?.err!==null)throw Error('Exact Hinkal Solana deposit simulation failed.');}
 async broadcast(r:HinkalSolanaIntent,s:any){verifyHinkalSolanaResponse(s,r,{deviceId:r.deviceId,solanaAddress:r.from});await this.preflight(r);validateHinkalSolana(r);const hash=await this.rpc('sendTransaction',[s.rawSignedTransaction,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);if(hash!==s.transactionHash)throw Error('Uncertain Hinkal Solana broadcast; reconcile approved hash only.');return hash;}
 async reconcile(r:HinkalSolanaIntent,s:any){verifyHinkalSolanaResponse(s,r,{deviceId:r.deviceId,solanaAddress:r.from},Date.now(),false);await this.adapter.identity('solana');const status=(await this.rpc('getSignatureStatuses',[[s.transactionHash],{searchTransactionHistory:true}])).value?.[0];if(status?.err)return {state:'failed',receipt:status};if(status?.confirmationStatus==='finalized'){const receipt=await this.rpc('getTransaction',[s.transactionHash,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);if(receipt?.slot!==status.slot)throw Error('Finalized Hinkal Solana slot differs.');return {state:'confirmed',receipt,...await hinkalSolanaSettlement(r,s,receipt)};}return {state:status?'pending':safe(await this.rpc('getBlockHeight',[{commitment:'finalized'}]))>r.lastValidBlockHeight?'expired-unresolved':'uncertain'};}
}
