import {VersionedTransaction,AddressLookupTableProgram} from '@solana/web3.js';
import {Interface,keccak256} from 'ethers';
import {OnlineAdapter,boundedJSON} from './adapter';
import {LifiRelaySourceAdapter,relayBlockHeader} from './lifi-relay-source';
import {verifyCctpSolanaLookups} from './cctp-solana-lookups';
import {validateLifiRelay,verifyLifiRelayResponse,LifiRelayIntent} from '../engine/core/lifi-relay-intent';
import {lifiRelaySolanaDestinationSettlement} from '../engine/core/relay-solana-destination';
import {lifiRelayEthereumDestinationSettlement,assertRelayEthereumUsdcIdentity,RELAY_USDC_IDENTITY} from '../engine/core/relay-ethereum-destination';
import {LookupSnapshot} from '../engine/core/lifi-solana-inspect';
import {CHAINS} from '../engine/core/payment-intent';
const token=new Interface(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)']);
// The API supplies a bounded locator, never settlement or finality evidence.
export function relayDestinationLocator(r:LifiRelayIntent,sourceHash:string,j:any){
 if(!Array.isArray(j?.requests)||j.requests.length>2)throw Error('Unbounded Relay request lookup.');
 if(!j.requests.length)return null;
 if(j.requests.length!==1)throw Error('Ambiguous Relay request lookup.');
 const x=j.requests[0],origin=r.version===26?1:792703809,destination=r.version===26?792703809:1;
 if(x.id!==r.relayRequestId||x.protocol?.orderId!==(r.relayProtocol as any).orderId||x.protocol.deposit?.origin?.transactionId!==sourceHash||x.protocol.deposit.origin.chainId!==origin||!Array.isArray(x.data?.inTxs)||x.data.inTxs.filter((t:any)=>t.hash===sourceHash&&t.chainId===origin).length!==1)throw Error('Relay locator does not bind the approved source order.');
 const fills=x.protocol.settlement?.destination?.fills;if(fills===undefined||fills.length===0)return null;
 if(!Array.isArray(fills)||fills.length!==1||fills[0].chainId!==destination||!Array.isArray(x.data?.outTxs)||x.data.outTxs.filter((t:any)=>t.hash===fills[0].transactionId&&t.chainId===destination).length!==1)throw Error('Unknown or ambiguous Relay destination fill.');
 const hash=fills[0].transactionId;if(typeof hash!=='string'||!(r.version===26?/^[1-9A-HJ-NP-Za-km-z]{64,88}$/:/^0x[0-9a-f]{64}$/).test(hash))throw Error('Relay destination hash format differs.');return hash;
}
export class LifiRelayDestinationAdapter{
 constructor(readonly adapter:OnlineAdapter,readonly providerTransport=boundedJSON){}
 async reconcile(request:unknown,response:unknown){
  const r=validateLifiRelay(request,Date.now(),false),s=verifyLifiRelayResponse(response,r,{deviceId:r.deviceId,...r.version===26?{evmAddress:r.from}:{solanaAddress:r.from}},Date.now(),false),source=await new LifiRelaySourceAdapter(this.adapter).reconcile(r,s);
  if(!('sourceState' in source)||source.sourceState!=='confirmed'||source.finalityVerified!==true)return source;
  const pending={...source,state:'destination-pending',completeRoute:false},j=await this.providerTransport('https://api.relay.link/requests/v2?id='+encodeURIComponent(r.relayRequestId)+'&limit=2'),hash=relayDestinationLocator(r,s.transactionHash,j);if(!hash)return{...pending,reason:'No unique source-bound destination locator.'};
  await this.adapter.identity(r.destinationChain);
  const rpc=(method:string,params:any[])=>this.adapter.rpc(r.destinationChain,method,params);
  if(r.version===26){
   const status=(await rpc('getSignatureStatuses',[[hash],{searchTransactionHistory:true}])).value?.[0];if(status?.err)return{...pending,destinationState:'failed',destinationStatus:status};if(status?.confirmationStatus!=='finalized')return{...pending,destinationTransactionHash:hash,destinationState:status?'pending':'unobserved'};
   const receipt=await rpc('getTransaction',[hash,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);if(!receipt||receipt.slot!==status.slot)throw Error('Relay destination finalized slot differs.');
   const tx=VersionedTransaction.deserialize(Buffer.from(receipt.transaction[0],'base64')),snapshots:LookupSnapshot[]=[];for(const t of tx.message.addressTableLookups){const v=await rpc('getAccountInfo',[t.accountKey.toBase58(),{encoding:'base64',commitment:'finalized',minContextSlot:receipt.slot}]);if(v.value?.owner!==AddressLookupTableProgram.programId.toBase58()||v.value.executable||!Number.isSafeInteger(v.context?.slot)||v.context.slot<receipt.slot)throw Error('Relay destination lookup identity differs.');snapshots.push({address:t.accountKey.toBase58(),owner:v.value.owner,dataBase64:v.value.data[0],contextSlot:v.context.slot});}
   const destination=lifiRelaySolanaDestinationSettlement(r,s,receipt,hash,snapshots),lookupEvidence=await verifyCctpSolanaLookups(this.adapter,destination,receipt.slot),again=(await rpc('getSignatureStatuses',[[hash],{searchTransactionHistory:true}])).value?.[0];if(again?.err!==null||again?.confirmationStatus!=='finalized'||again.slot!==receipt.slot)throw Error('Relay destination finality changed during observation.');
   return{state:'confirmed',completeRoute:true,source,sourceTransactionHash:s.transactionHash,destinationTransactionHash:hash,destination:{...destination,...lookupEvidence,finalityVerified:true,receipt,lookupSnapshots:snapshots,finalizedStatus:again},recipient:r.recipient,asset:r.tokenOut,output:destination.output,providerStatusUsedAsSettlement:false};
  }
  const receipt=await rpc('eth_getTransactionReceipt',[hash]);if(!receipt)return{...pending,destinationTransactionHash:hash,destinationState:'unobserved'};
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]);if(block?.hash!==receipt.blockHash||!Array.isArray(block.transactions)||!block.transactions.includes(hash))throw Error('Relay destination canonical block inclusion differs.');if(!finalized||BigInt(finalized.number)<BigInt(receipt.blockNumber))return{...pending,destinationTransactionHash:hash,destinationState:'pending'};
  if(BigInt(receipt.status)!==1n)return{...pending,destinationTransactionHash:hash,destinationState:'failed',destinationReceipt:receipt};
  const prior='0x'+(BigInt(receipt.blockNumber)-1n).toString(16),previous=await rpc('eth_getBlockByNumber',[prior,false]);if(previous?.hash!==block.parentHash)throw Error('Relay destination parent block differs.');
  const transaction=await rpc('eth_getTransactionByHash',[hash]),balance=async(tag:string)=>BigInt(token.decodeFunctionResult('balanceOf',await rpc('eth_call',[{to:CHAINS.ethereum.usdc,data:token.encodeFunctionData('balanceOf',[r.recipient])},tag]))[0]).toString(),before=await balance(prior),after=await balance(receipt.blockNumber),nativeBefore=BigInt(await rpc('eth_getBalance',[r.recipient,prior])).toString(),nativeAfter=BigInt(await rpc('eth_getBalance',[r.recipient,receipt.blockNumber])).toString(),codeHash=keccak256(await rpc('eth_getCode',[CHAINS.ethereum.usdc,receipt.blockNumber]));
  if(codeHash!=='0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505'||token.decodeFunctionResult('decimals',await rpc('eth_call',[{to:CHAINS.ethereum.usdc,data:token.encodeFunctionData('decimals')},receipt.blockNumber]))[0]!==6n)throw Error('Canonical Ethereum USDC payout identity differs.');
  const storageWord=await rpc('eth_getStorageAt',[CHAINS.ethereum.usdc,RELAY_USDC_IDENTITY.implementationSlot,receipt.blockNumber]),tokenIdentity={proxyCodeHash:codeHash,storageWord,implementationSlot:RELAY_USDC_IDENTITY.implementationSlot,implementation:'0x'+storageWord.slice(-40),implementationCodeHash:keccak256(await rpc('eth_getCode',[RELAY_USDC_IDENTITY.implementation,receipt.blockNumber]))};assertRelayEthereumUsdcIdentity(tokenIdentity);
  const destination=lifiRelayEthereumDestinationSettlement(r,s,receipt,transaction,before,after,nativeBefore,nativeAfter,Number(BigInt(block.timestamp))),again=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),finalizedAgain=await rpc('eth_getBlockByNumber',['finalized',false]);if(again?.hash!==block.hash||!finalizedAgain||BigInt(finalizedAgain.number)<BigInt(receipt.blockNumber))throw Error('Relay destination finality changed during observation.');
  return{state:'confirmed',completeRoute:true,source,sourceTransactionHash:s.transactionHash,destinationTransactionHash:hash,destination:{...destination,finalityVerified:true,receipt,transaction,balanceBefore:before,balanceAfter:after,nativeBefore,nativeAfter,canonicalBlock:block,previousBlock:relayBlockHeader(previous),finalizedBlock:relayBlockHeader(finalizedAgain),tokenCodeHash:codeHash,tokenIdentity},recipient:r.recipient,asset:r.tokenOut,output:destination.output,providerStatusUsedAsSettlement:false};
 }
}
