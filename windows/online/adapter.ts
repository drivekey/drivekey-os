// ONLINE ONLY: public identity and signed bytes; never a vault or password.
import { randomUUID } from 'node:crypto';
import { Transaction as EthTransaction, getAddress } from 'ethers';
import { Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { z } from 'zod';
import {verifiedSolanaBlockHeight} from './solana-block-height';
import { CHAINS, Chain, ERC20_PAYMENT, paymentFingerprint, validatePayment, verifyPaymentResponse, PaymentIntent, PaymentResponse, solPayment } from '../engine/core/payment-intent';

export async function boundedJSON(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw Error('Provider unavailable (HTTP '+response.status+'); no success was inferred.');
  const reader = response.body.getReader(); let size = 0; const parts: Uint8Array[] = [];
  try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>2*1024*1024)throw Error('Provider response exceeds limit.');parts.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw Error('Malformed provider JSON.'); }
}
const hexQuantity = (v: any): bigint => { if(typeof v!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v)||v.length>66)throw Error('Malformed RPC quantity.'); return BigInt(v); };
const safeInteger = (v: any) => {if(!Number.isSafeInteger(v)||v<0)throw Error('Malformed RPC integer.');return v as number;};
export class OnlineAdapter {
  constructor(readonly endpoints: Partial<Record<Chain,string>>, readonly transport = boundedJSON) {
    for(const url of Object.values(endpoints)){const u=new URL(url!);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw Error('RPC requires HTTPS or localhost.');if(u.username||u.password||u.hash)throw Error('Unsupported RPC URL.');}
  }
  async rpc(chain: Chain, method: string, params: any[]): Promise<any> {
    if(chain==='solana'&&method==='getBlockHeight'){
      if(!Array.isArray(params)||params.length>1||params[0]!==undefined&&(!params[0]||typeof params[0]!=='object'||Array.isArray(params[0])||Object.keys(params[0]).some(k=>!['commitment','minContextSlot'].includes(k))))throw Error('Unsupported block-height parameters.');
      const config=params[0]||{},commitment=config.commitment||'finalized';
      if(!['confirmed','finalized'].includes(commitment)||config.minContextSlot!==undefined&&(!Number.isSafeInteger(config.minContextSlot)||config.minContextSlot<0))throw Error('Unsupported verified block-height commitment or context.');
      return verifiedSolanaBlockHeight(this,commitment,config.minContextSlot);
    }
    const endpoint=this.endpoints[chain];if(!endpoint)throw Error('Configure a local RPC endpoint for this network.');
    const id=randomUUID();const body=await this.transport(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
    if(!body||body.jsonrpc!=='2.0'||body.id!==id||body.error||!Object.hasOwn(body,'result'))throw Error('RPC rejected or malformed response'+(Number.isInteger(body?.error?.code)?' (code '+body.error.code+')':'')+'.');return body.result;
  }
  async identity(chain: Chain) {
    const c=CHAINS[chain];if(!c)throw Error('Unsupported chain.');
    if(c.family==='ethereum'){if(hexQuantity(await this.rpc(chain,'eth_chainId',[]))!==BigInt((c as any).chainId))throw Error('RPC chain identity mismatch.');}
    else if(await this.rpc(chain,'getGenesisHash',[])!==(c as any).genesis)throw Error('RPC genesis mismatch.');
  }
  async balance(chain: Chain, from: string, asset: string, blockTag: 'pending' | 'latest' = 'pending') {
    if(blockTag!=='pending'&&blockTag!=='latest')throw Error('Invalid balance block tag.');
    await this.identity(chain);const c=CHAINS[chain];
    if(asset!==c.native&&asset!=='USDC')throw Error('Unsupported asset.');
    if(c.family==='ethereum'){
      getAddress(from);const native=hexQuantity(await this.rpc(chain,'eth_getBalance',[from,blockTag]));
      let amount=native;if(asset==='USDC'){
        const decimals=await this.rpc(chain,'eth_call',[{to:c.usdc,data:ERC20_PAYMENT.encodeFunctionData('decimals')},'latest']);
        if(ERC20_PAYMENT.decodeFunctionResult('decimals',decimals)[0]!==6n)throw Error('USDC decimals mismatch.');
        amount=ERC20_PAYMENT.decodeFunctionResult('balanceOf',await this.rpc(chain,'eth_call',[{to:c.usdc,data:ERC20_PAYMENT.encodeFunctionData('balanceOf',[from])},blockTag]))[0];
      } return { amount:amount.toString(), native:native.toString() };
    }
    const owner=new PublicKey(from),native=safeInteger((await this.rpc(chain,'getBalance',[from,{commitment:'confirmed'}])).value);
    if(asset==='SOL')return {amount:String(native),native:String(native)};
    const ata=getAssociatedTokenAddressSync(new PublicKey(c.usdc),owner).toBase58();
    const account=(await this.rpc(chain,'getAccountInfo',[ata,{encoding:'jsonParsed',commitment:'confirmed'}])).value;
    if(!account)return {amount:'0',native:String(native)};
    const info=account.data?.parsed?.info;
    if(account.owner!==TOKEN_PROGRAM_ID.toBase58()||info?.mint!==c.usdc||info?.owner!==from||info?.tokenAmount?.decimals!==6||!/^\d+$/.test(info.tokenAmount.amount))throw Error('Malformed USDC account.');
    return {amount:info.tokenAmount.amount,native:String(native)};
  }
  async prepare(input: unknown, wallet: any, now=Date.now()) {
    const p=z.object({chain:z.enum(['ethereum','sepolia','solana','devnet']),asset:z.enum(['ETH','SOL','USDC']),recipient:z.string().min(32).max(64),amount:z.string().regex(/^[1-9][0-9]*$/).max(38)}).strict().parse(input);
    const c=CHAINS[p.chain],from=c.family==='ethereum'?wallet.evmAddress:wallet.solanaAddress;
    const r:any={version:8,action:'payment',requestId:randomUUID(),deviceId:wallet.deviceId,chain:p.chain,network:c.family,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+10*60000).toISOString(),from,recipient:p.recipient,asset:p.asset,amount:p.amount,maximumFee:'0',accountRent:'0',createRecipientAccount:false,blockhash:null,lastValidBlockHeight:null};
    const balance=await this.balance(p.chain,from,p.asset);
    if(c.family==='ethereum'){
      getAddress(p.recipient);const nonce=Number(hexQuantity(await this.rpc(p.chain,'eth_getTransactionCount',[from,'pending'])));
      const price=hexQuantity(await this.rpc(p.chain,'eth_gasPrice',[])),maxFee=price*2n,priority=maxFee<1000000000n?maxFee:1000000000n;
      const call={from,to:p.asset==='ETH'?p.recipient:c.usdc,value:p.asset==='ETH'?'0x'+BigInt(p.amount).toString(16):'0x0',data:p.asset==='ETH'?'0x':ERC20_PAYMENT.encodeFunctionData('transfer',[p.recipient,p.amount])};
      const estimate=hexQuantity(await this.rpc(p.chain,'eth_estimateGas',[call]));const gas=estimate*120n/100n;
      r.maximumFee=(gas*maxFee).toString();r.unsignedTransaction=EthTransaction.from({type:2,chainId:(c as any).chainId,nonce,to:call.to,value:call.value,data:call.data,gasLimit:gas,maxFeePerGas:maxFee,maxPriorityFeePerGas:priority}).unsignedSerialized;
    }else{
      new PublicKey(p.recipient);const latest=(await this.rpc(p.chain,'getLatestBlockhash',[{commitment:'confirmed'}])).value;
      r.blockhash=latest.blockhash;r.lastValidBlockHeight=safeInteger(latest.lastValidBlockHeight);
      if(p.asset==='USDC'){
        const target=getAssociatedTokenAddressSync(new PublicKey(c.usdc),new PublicKey(p.recipient)).toBase58();
        const existing=(await this.rpc(p.chain,'getAccountInfo',[target,{encoding:'jsonParsed',commitment:'confirmed'}])).value;
        if(existing){const info=existing.data?.parsed?.info;if(existing.owner!==TOKEN_PROGRAM_ID.toBase58()||info?.owner!==p.recipient||info?.mint!==c.usdc)throw Error('Recipient USDC account mismatch.');}
        else {r.createRecipientAccount=true;r.accountRent=String(safeInteger(await this.rpc(p.chain,'getMinimumBalanceForRentExemption',[165])));}
      }
      const tx=solPayment(r);r.unsignedTransaction=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
      const fee=(await this.rpc(p.chain,'getFeeForMessage',[tx.serializeMessage().toString('base64'),{commitment:'confirmed'}])).value;
      r.maximumFee=String(safeInteger(fee));
    }
    r.fingerprint=paymentFingerprint(r);validatePayment(r,now);
    if(BigInt(balance.amount)<BigInt(r.amount)||BigInt(balance.native)<BigInt(r.maximumFee)+BigInt(r.accountRent)+(r.asset===c.native?BigInt(r.amount):0n))throw Error('Insufficient funds for amount, maximum fee and rent.');
    return r as PaymentIntent;
  }
  async preflight(r: PaymentIntent) {
    validatePayment(r);await this.identity(r.chain);const b=await this.balance(r.chain,r.from,r.asset),c=CHAINS[r.chain];
    if(BigInt(b.amount)<BigInt(r.amount)||BigInt(b.native)<BigInt(r.maximumFee)+BigInt(r.accountRent)+(r.asset===c.native?BigInt(r.amount):0n))throw Error('Insufficient funds.');
    if(r.network==='ethereum'){
      if(hexQuantity(await this.rpc(r.chain,'eth_getTransactionCount',[r.from,'pending']))!==BigInt(EthTransaction.from(r.unsignedTransaction).nonce))throw Error('Nonce conflict; reconcile before preparing a separately approved transaction.');
      const tx=EthTransaction.from(r.unsignedTransaction);
      const result=await this.rpc(r.chain,'eth_call',[{from:r.from,to:tx.to,data:tx.data,value:'0x'+tx.value.toString(16)},'pending']);
      if(r.asset==='USDC'&&ERC20_PAYMENT.decodeFunctionResult('transfer',result)[0]!==true)throw Error('USDC transfer simulation failed.');
    }else{
      await this.checkSolanaRecipient(r);
      const valid=await this.rpc(r.chain,'isBlockhashValid',[r.blockhash,{commitment:'confirmed'}]);
      if(valid.value!==true||safeInteger(await this.rpc(r.chain,'getBlockHeight',[{commitment:'confirmed'}]))>r.lastValidBlockHeight!)throw Error('Solana blockhash expired. No replacement signature was created.');
      const fee=(await this.rpc(r.chain,'getFeeForMessage',[solPayment(r).serializeMessage().toString('base64'),{commitment:'confirmed'}])).value;
      if(BigInt(safeInteger(fee))>BigInt(r.maximumFee))throw Error('Solana fee exceeds the approved maximum.');
      if(r.createRecipientAccount&&BigInt(safeInteger(await this.rpc(r.chain,'getMinimumBalanceForRentExemption',[165])))>BigInt(r.accountRent))throw Error('Recipient rent exceeds the approved maximum.');
      const simulation=await this.rpc(r.chain,'simulateTransaction',[r.unsignedTransaction,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'}]);
      if(!simulation?.value||simulation.value.err!==null)throw Error('Solana payment simulation failed.');
    }
  }
  private async checkSolanaRecipient(r:PaymentIntent){
    const c=CHAINS[r.chain],owner=new PublicKey(r.recipient),target=r.asset==='USDC'?getAssociatedTokenAddressSync(new PublicKey(c.usdc),owner).toBase58():r.recipient;
    const account=(await this.rpc(r.chain,'getAccountInfo',[target,{encoding:'jsonParsed',commitment:'confirmed'}])).value;
    if(r.asset==='SOL'){if(account&&(account.owner!=='11111111111111111111111111111111'||account.executable))throw Error('Native recipient is not a controlled System account.');return;}
    if(!account){if(!r.createRecipientAccount)throw Error('Recipient USDC account disappeared.');return;}
    const info=account.data?.parsed?.info;
    if(account.owner!==TOKEN_PROGRAM_ID.toBase58()||account.executable||info?.owner!==r.recipient||info?.mint!==c.usdc||info?.tokenAmount?.decimals!==6)throw Error('Recipient USDC ownership, mint or decimals changed.');
  }
  async broadcast(r:PaymentIntent,s:PaymentResponse) {
    // Caller must durably mark submitting BEFORE invoking this method.
    this.verifyResponse(r,s,true);
    await this.identity(r.chain);
    const result=await this.rpc(r.chain,r.network==='ethereum'?'eth_sendRawTransaction':'sendTransaction',r.network==='ethereum'?[s.rawSignedTransaction]:[s.rawSignedTransaction,{encoding:'base64',skipPreflight:false,maxRetries:0}]);
    if(result!==s.transactionHash)throw Error('Broadcast response hash mismatch; reconcile the approved hash.');return result;
  }
  async reconcile(r:PaymentIntent,s:PaymentResponse) {
    this.verifyResponse(r,s,false);
    await this.identity(r.chain);
    if(r.network==='ethereum'){
      const receipt=await this.rpc(r.chain,'eth_getTransactionReceipt',[s.transactionHash]);
      if(receipt){
        if(receipt.transactionHash?.toLowerCase()!==s.transactionHash.toLowerCase())throw Error('Receipt hash mismatch.');
        const block=await this.rpc(r.chain,'eth_getBlockByNumber',[receipt.blockNumber,false]);
        if(!block||block.hash!==receipt.blockHash)return {state:'uncertain',reason:'Reorg or inconsistent block.'};
        const finalized=await this.rpc(r.chain,'eth_getBlockByNumber',['finalized',false]);
        if(!finalized||hexQuantity(finalized.number)<hexQuantity(receipt.blockNumber))return {state:'pending',receipt};
        if(hexQuantity(receipt.status)!==1n)return {state:'failed',receipt};
        const observed=await this.rpc(r.chain,'eth_getTransactionByHash',[s.transactionHash]),approved=EthTransaction.from(s.rawSignedTransaction);
        if(!observed||observed.hash!==s.transactionHash||observed.blockHash!==receipt.blockHash||getAddress(observed.from)!==getAddress(r.from)||!observed.to||getAddress(observed.to)!==approved.to||observed.input!==approved.data||hexQuantity(observed.value)!==approved.value||hexQuantity(observed.nonce)!==BigInt(approved.nonce)||hexQuantity(observed.chainId)!==approved.chainId)throw Error('Finalized Ethereum transaction differs from approved payment.');
        if(hexQuantity(receipt.gasUsed)*hexQuantity(receipt.effectiveGasPrice)>BigInt(r.maximumFee))throw Error('Settled Ethereum fee exceeds approval.');
        if(r.asset==='USDC'){
          const matches=(receipt.logs||[]).filter((log:any)=>{try{const e=ERC20_PAYMENT.parseLog(log);return getAddress(log.address)===getAddress(CHAINS[r.chain].usdc)&&e?.name==='Transfer'&&getAddress(e.args.from)===getAddress(r.from)&&getAddress(e.args.to)===getAddress(r.recipient)&&e.args.value===BigInt(r.amount);}catch{return false;}});
          if(matches.length!==1)throw Error('Finalized receipt lacks the exact USDC transfer.');
        }
        return {state:'confirmed',receipt};
      }
      if(await this.rpc(r.chain,'eth_getTransactionByHash',[s.transactionHash]))return {state:'pending'};
      const latest=hexQuantity(await this.rpc(r.chain,'eth_getTransactionCount',[r.from,'latest']));
      if(latest>BigInt(EthTransaction.from(r.unsignedTransaction).nonce))return {state:'conflict',reason:'Nonce consumed by another transaction. Do not retry or replace automatically.'};
      return {state:'uncertain',reason:'Approved hash not found. Absence from one RPC is not proof of non-broadcast.'};
    }
    const statuses=await this.rpc(r.chain,'getSignatureStatuses',[[s.transactionHash],{searchTransactionHistory:true}]),status=statuses.value?.[0];
    if(status){if(status.err)return {state:'failed',receipt:status};if(status.confirmationStatus==='finalized'){
      const settled=await this.rpc(r.chain,'getTransaction',[s.transactionHash,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      if(!settled||settled.meta?.err!==null||!Array.isArray(settled.transaction)||settled.transaction[1]!=='base64'||settled.slot!==status.slot)throw Error('Finalized Solana transaction evidence unavailable or inconsistent.');
      // A status alone is insufficient: match every signed byte to the independently fetched transaction.
      if(settled.transaction[0]!==s.rawSignedTransaction)throw Error('Finalized Solana transaction differs from approved payment.');
      const fee=safeInteger(settled.meta.fee);if(BigInt(fee)>BigInt(r.maximumFee))throw Error('Settled Solana fee exceeds approval.');
      if(r.asset==='USDC'){
        const tx=Transaction.from(Buffer.from(s.rawSignedTransaction,'base64')),keys=tx.compileMessage().accountKeys;
        const target=getAssociatedTokenAddressSync(new PublicKey(CHAINS[r.chain].usdc),new PublicKey(r.recipient)),index=keys.findIndex(k=>k.equals(target));
        const pre=settled.meta.preTokenBalances?.find((b:any)=>b.accountIndex===index),post=settled.meta.postTokenBalances?.find((b:any)=>b.accountIndex===index);
        const valid=(b:any)=>b&&b.mint===CHAINS[r.chain].usdc&&b.owner===r.recipient&&b.uiTokenAmount?.decimals===6&&/^(0|[1-9][0-9]*)$/.test(b.uiTokenAmount.amount);
        if(!valid(post)||(pre&&!valid(pre))||(!pre&&!r.createRecipientAccount)||BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount||'0')!==BigInt(r.amount))throw Error('Finalized Solana token ownership or exact credit mismatch.');
      }else{
        const tx=Transaction.from(Buffer.from(s.rawSignedTransaction,'base64')),index=tx.compileMessage().accountKeys.findIndex(k=>k.toBase58()===r.recipient);
        const before=safeInteger(settled.meta.preBalances?.[index]),after=safeInteger(settled.meta.postBalances?.[index]);
        if(BigInt(after)-BigInt(before)!==BigInt(r.amount))throw Error('Finalized Solana native credit mismatch.');
      }
      return {state:'confirmed',receipt:settled};
    }return {state:'pending',receipt:status};}
    if(safeInteger(await this.rpc(r.chain,'getBlockHeight',[{commitment:'finalized'}]))>r.lastValidBlockHeight!)return {state:'expired-unresolved',reason:'Blockhash expired and signature not found. Check independent RPC/history before approving a new intent.'};
    return {state:'uncertain',reason:'Signature not found; no automatic rebroadcast.'};
  }
  private verifyResponse(r:PaymentIntent,s:PaymentResponse,expiry:boolean){
    verifyPaymentResponse(s,r,{deviceId:r.deviceId,evmAddress:r.network==='ethereum'?r.from:undefined,solanaAddress:r.network==='solana'?r.from:undefined},Date.now(),expiry);
  }
}
