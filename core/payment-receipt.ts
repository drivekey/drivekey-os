import { getAddress,parseUnits } from 'ethers';
import { Connection,PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { validatePaymentRequest,SOL_USDC } from './payment-request';
import { ETH_TOKENS,TOKEN } from './trade-protocol';
import { SOLANA_GENESIS } from './multi-protocol';
import type { Rpc } from './protocol';
export async function paymentReceipt(input:unknown,hash:string,rpc:Rpc,sol:Connection) {
 const p=validatePaymentRequest(input),required=p.amount?parseUnits(p.amount,p.asset==='USDC'?6:p.asset==='SOL'?9:18):null;
 if(p.network==='ethereum'||p.network==='robinhood') {
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Invalid Ethereum transaction hash.');
  if(BigInt(String(await rpc('eth_chainId')))!==(p.network==='robinhood'?4663n:1n))throw Error('Wrong payment network.');
  const receipt=await rpc('eth_getTransactionReceipt',[hash]) as {transactionHash:string;status:string;blockNumber:string;blockHash:string;logs:{address:string;topics:string[];data:string}[]}|null;
  if(!receipt)return {state:'pending',message:'No receipt yet.'};
  if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase())throw Error('Receipt hash mismatch.');
  if(!['0x0','0x1'].includes(receipt.status))throw Error('Invalid receipt status.');
  const tx=await rpc('eth_getTransactionByHash',[hash]) as {hash:string;from:string;to:string;value:string;input:string;blockHash:string;blockNumber:string}|null;
  if(!tx)return {state:'pending',message:'Waiting for matching transaction evidence.'};
  if(tx.hash.toLowerCase()!==hash.toLowerCase()||!/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber)throw Error('Transaction and receipt evidence disagree.');
  const canonical=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]) as {hash:string}|null;
  if(canonical?.hash!==receipt.blockHash)throw Error('Receipt block is not canonical.');
  const final=await rpc('eth_getBlockByNumber',['finalized',false]) as {number:string}|null;
  const finalized=!!final&&BigInt(final.number)>=BigInt(receipt.blockNumber);
  if(receipt.status==='0x0')return {state:finalized?'failed':'pending',finality:finalized?'finalized':'confirmed',message:finalized?'Matching finalized transaction failed.':'Failure receipt is not finalized.'};
  let amount=0n;
  if(p.asset==='ETH') {if(!tx.to||getAddress(tx.to)!==p.recipient||tx.input!=='0x')return {state:'mismatch',message:'Not a direct payment to this recipient.'};amount=BigInt(tx.value);}
  else {const token=ETH_TOKENS[p.asset as 'WETH'|'USDC'].address;let transfer;try{transfer=TOKEN.parseTransaction({data:tx.input});}catch{/* Unsupported calldata. */}if(!tx.to||getAddress(tx.to)!==token||BigInt(tx.value)!==0n||transfer?.name!=='transfer'||getAddress(transfer.args[0])!==p.recipient)return {state:'mismatch',message:'Not a direct allowlisted token payment.'};const matches=receipt.logs.filter(log=>{try{const e=TOKEN.parseLog(log);return getAddress(log.address)===token&&e?.name==='Transfer'&&getAddress(e.args[0])===getAddress(tx.from)&&getAddress(e.args[1])===p.recipient&&e.args[2]===transfer.args[1];}catch{return false;}});if(matches.length===1)amount=transfer.args[1];}
  if(amount<=0n||(required!==null&&amount!==required))return {state:'mismatch',message:'Recipient, asset or exact amount did not match.'};
  return {state:finalized?'confirmed':'pending',finality:finalized?'finalized':'confirmed',amount:amount.toString(),hash,message:'Matching transaction and canonical receipt. Verify this hash is not reused for another request.'};
 }
 if(!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(hash))throw Error('Invalid Solana signature.');
 if(await sol.getGenesisHash()!==SOLANA_GENESIS)throw Error('Wrong Solana cluster.');
 const tx=await sol.getParsedTransaction(hash,{commitment:'finalized',maxSupportedTransactionVersion:0});
 if(!tx)return {state:'pending',message:'No finalized transaction yet.'};
 if(tx.transaction.signatures[0]!==hash)throw Error('Transaction signature mismatch.');
 if(tx.meta?.err)return {state:'failed',message:'Transaction failed.'};
 if(!tx.meta)throw Error('Missing transaction metadata.');
 let amount=0n;
 const instructions=[...tx.transaction.message.instructions,...(tx.meta.innerInstructions||[]).flatMap(i=>i.instructions)];
 const ata=getAssociatedTokenAddressSync(new PublicKey(SOL_USDC),new PublicKey(p.recipient)).toBase58();
 for(const instruction of instructions){if(!('parsed' in instruction))continue;const parsed=instruction.parsed as {type:string;info:Record<string,unknown>};
  if(p.asset==='SOL'&&instruction.program==='system'&&parsed.type==='transfer'&&parsed.info.destination===p.recipient){const n=parsed.info.lamports;if(typeof n==='number'&&Number.isSafeInteger(n)&&n>0)amount+=BigInt(n);}
  if(p.asset==='USDC'&&instruction.program==='spl-token'&&parsed.type==='transferChecked'&&parsed.info.destination===ata&&parsed.info.mint===SOL_USDC){const a=parsed.info.tokenAmount as {amount:string;decimals:number};if(a.decimals===6&&/^[0-9]+$/.test(a.amount))amount+=BigInt(a.amount);}
 }
 if(amount<=0n||(required!==null&&amount!==required))return {state:'mismatch',message:'No matching finalized transfer to the requested wallet.'};
 return {state:'confirmed',amount:amount.toString(),hash,message:'Matching finalized transfer. A transaction hash must not be reused as evidence for another request.'};
}
