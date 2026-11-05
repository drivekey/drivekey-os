// Settlement authority: configured chain RPC, canonical finalized blocks; browser input is only a hash hint.
import { getAddress } from 'ethers';
import { Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { OnlineAdapter } from '../online/adapter';
import { CHAINS, Chain, ERC20_PAYMENT } from '../engine/core/payment-intent';
import { Evidence, normalizeAddress } from './service';
import {verifiedSolanaTransaction} from '../engine/core/solana-message';
export class SettlementVerifier {
 constructor(readonly adapter:OnlineAdapter){}
 async verify(invoice:any,hash:string):Promise<Evidence[]>{
  const chain=invoice.chain as Chain,c=CHAINS[chain];await this.adapter.identity(chain);
  const rpc=(m:string,p:any[])=>this.adapter.rpc(chain,m,p);
  if(c.family==='ethereum'){
   if(!/^0x[0-9a-fA-F]{64}$/.test(hash)||hash!==hash.toLowerCase())throw Error('Invalid canonical Ethereum hash.');
   const receipt=await rpc('eth_getTransactionReceipt',[hash]);if(!receipt||receipt.transactionHash!==hash||receipt.status!=='0x1')throw Error('Payment not successful.');
   const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
   if(!block||!finalized||BigInt(finalized.number)<BigInt(receipt.blockNumber))throw Error('Payment not finalized.');
   const canonical=block.hash===receipt.blockHash,chainTime=new Date(Number(BigInt(block.timestamp))*1000).toISOString();
   if(!canonical)throw Error('Reorg: payment block is no longer canonical.');
   const base={chain,asset:invoice.asset,recipient:invoice.address,transactionHash:hash,chainTime,canonical,proof:{blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,finalizedBlock:finalized.number}};
   if(invoice.asset==='ETH'){
    const tx=await rpc('eth_getTransactionByHash',[hash]);
    if(!tx||tx.hash!==hash||tx.blockHash!==block.hash||!tx.to||getAddress(tx.to).toLowerCase()!==invoice.address||tx.input!=='0x'||BigInt(tx.value)<=0n)throw Error('Wrong native recipient or unsupported contract payment.');
    return [{...base,amount:BigInt(tx.value).toString(),eventIndex:0}];
   }
   if(invoice.asset!=='USDC')throw Error('Unsupported Ethereum asset.');
   return (receipt.logs||[]).flatMap((log:any)=>{try{if(log.removed||getAddress(log.address)!==getAddress(c.usdc)||log.transactionHash!==hash||log.blockHash!==block.hash)return [];const event=ERC20_PAYMENT.parseLog(log);if(event?.name!=='Transfer'||getAddress(event.args.to).toLowerCase()!==invoice.address||event.args.value<=0n)return [];return [{...base,amount:event.args.value.toString(),eventIndex:Number(BigInt(log.logIndex))}];}catch{return [];}});
  }
  if(bs58.decode(hash).length!==64)throw Error('Invalid Solana signature.');
  const value=await rpc('getTransaction',[hash,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if(!value||value.meta?.err!==null||!Number.isSafeInteger(value.blockTime)||!Array.isArray(value.transaction)||value.transaction[1]!=='base64')throw Error('Solana payment not finalized or unsuccessful.');
  const tx=verifiedSolanaTransaction(value,hash);
  const chainTime=new Date(value.blockTime*1000).toISOString(),base={chain,asset:invoice.asset,recipient:invoice.address,transactionHash:hash,chainTime,canonical:true,proof:{slot:value.slot,signature:hash}};
  const result:Evidence[]=[];
  for(const [index,ix]of tx.instructions.entries()){
   if(invoice.asset==='SOL'&&ix.programId.toBase58()==='11111111111111111111111111111111'&&ix.data.length===12&&ix.data.readUInt32LE(0)===2&&ix.keys.length===2&&ix.keys[0].isSigner&&normalizeAddress(chain,ix.keys[1].pubkey.toBase58())===invoice.address){const accountIndex=tx.keys.findIndex(k=>k.equals(ix.keys[1].pubkey)),before=value.meta.preBalances?.[accountIndex],after=value.meta.postBalances?.[accountIndex],amount=ix.data.readBigUInt64LE(4);if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||BigInt(after)-BigInt(before)!==amount)throw Error('Solana invoice native credit mismatch.');result.push({...base,eventIndex:index,amount:amount.toString()});}
   if(invoice.asset==='USDC'&&ix.programId.equals(TOKEN_PROGRAM_ID)&&ix.data.length===10&&ix.data[0]===12&&ix.data[9]===6&&ix.keys.length===4&&ix.keys[3].isSigner){
    const mint=new PublicKey(c.usdc),target=getAssociatedTokenAddressSync(mint,new PublicKey(invoice.address));
    if(ix.keys[1].pubkey.equals(mint)&&ix.keys[2].pubkey.equals(target)){
     const accountIndex=tx.keys.findIndex(k=>k.equals(target)),pre=value.meta.preTokenBalances?.find((b:any)=>b.accountIndex===accountIndex),post=value.meta.postTokenBalances?.find((b:any)=>b.accountIndex===accountIndex),amount=ix.data.readBigUInt64LE(1);
     const valid=(b:any)=>b&&b.mint===c.usdc&&b.owner===invoice.address&&b.uiTokenAmount?.decimals===6&&/^(0|[1-9][0-9]*)$/.test(b.uiTokenAmount.amount);
     if(!valid(post)||(pre&&!valid(pre))||BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount||'0')!==amount)throw Error('Solana invoice token ownership or exact credit mismatch.');
     result.push({...base,eventIndex:index,amount:amount.toString()});
    }
   }
  }
  const credits=result.filter(r=>BigInt(r.amount)>0n);
  // The balance delta covers the whole transaction and cannot prove multiple claims.
  if(credits.length>1)throw Error('Ambiguous Solana invoice credit.');
  return credits;
 }
 async discover(invoice:any):Promise<string[]>{
  const chain=invoice.chain as Chain,c=CHAINS[chain],rpc=(m:string,p:any[])=>this.adapter.rpc(chain,m,p);await this.adapter.identity(chain);
  if(c.family==='solana'){
   const address=invoice.asset==='USDC'?getAssociatedTokenAddressSync(new PublicKey(c.usdc),new PublicKey(invoice.address)).toBase58():invoice.address;
   const signatures=await rpc('getSignaturesForAddress',[address,{limit:100},'finalized']);if(!Array.isArray(signatures))throw Error('Malformed signature history.');
   const found:string[]=[];let page=signatures;
   for(let pages=0;pages<100;pages++){
    for(const s of page)if(s.err===null&&s.blockTime*1000>=new Date(invoice.created_at).getTime())found.push(s.signature);
    if(page.length<100||page.some((s:any)=>s.blockTime&&s.blockTime*1000<new Date(invoice.created_at).getTime()))return found;
    page=await rpc('getSignaturesForAddress',[address,{limit:100,before:page.at(-1).signature},'finalized']);if(!Array.isArray(page))throw Error('Malformed signature history.');
   }throw Error('Solana history pagination limit reached; operator backfill required.');
  }
  const end=await rpc('eth_getBlockByNumber',['finalized',false]);const height=BigInt(end.number),start=invoice.scan_from!==undefined?BigInt(invoice.scan_from):(height>128n?height-128n:0n);
  const finish=start+127n<height?start+127n:height,toBlock='0x'+finish.toString(16);
  if(invoice.asset==='USDC'){
   const logs=await rpc('eth_getLogs',[{address:c.usdc,fromBlock:'0x'+start.toString(16),toBlock,topics:[ERC20_PAYMENT.getEvent('Transfer')!.topicHash,null,'0x'+invoice.address.slice(2).padStart(64,'0')]}]);
   if(!Array.isArray(logs))throw Error('Malformed transfer history.');return [...new Set<string>(logs.map((l:any)=>l.transactionHash))];
  }
  const found:string[]=[];for(let n=start;n<=finish;n++){const block=await rpc('eth_getBlockByNumber',['0x'+n.toString(16),true]);if(!block)throw Error('Missing historical block. Scan checkpoint was not advanced.');if(Number(BigInt(block.timestamp))*1000<new Date(invoice.created_at).getTime())continue;for(const tx of block.transactions||[])if(tx.to?.toLowerCase()===invoice.address)found.push(tx.hash);}return found;
 }
}
