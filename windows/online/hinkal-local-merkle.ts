import {Interface,getAddress,keccak256} from 'ethers';
import {OnlineAdapter} from './adapter';
import {HINKAL_PIN,HINKAL_ABI} from '../engine/core/hinkal-intent';
import {bootstrapHinkalMerkle,appendHinkalMerkle,makeHinkalLocalWitness,HINKAL_MERKLE_MIN,hinkalMerkleDepth} from '../engine/core/hinkal-local-merkle';
const {preProcessing}=require('../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),abi=new Interface(['function m_index() view returns(uint256)','function getRootHash() view returns(uint256)','function tree(uint256) view returns(uint256)']);
export async function captureHinkalFrontier(a:OnlineAdapter,tag='finalized'){await a.identity('ethereum');const block=await a.rpc('ethereum','eth_getBlockByNumber',[tag,false]);if(!block?.hash||keccak256(await a.rpc('ethereum','eth_getCode',[HINKAL_PIN.ethereumContract,block.number]))!==HINKAL_PIN.ethereumCodeHash)throw Error('Public Hinkal frontier deployment or block unavailable.');const read=async(name:string,args:any[]=[])=>abi.decodeFunctionResult(name,await a.rpc('ethereum','eth_call',[{to:HINKAL_PIN.ethereumContract,data:abi.encodeFunctionData(name,args)},block.number]))[0] as bigint,mIndex=await read('m_index'),root=await read('getRootHash'),depth=hinkalMerkleDepth(mIndex-HINKAL_MERKLE_MIN),frontier=Array(26).fill('0');for(let i=0;i<=depth;i++)frontier[i]=(await read('tree',[i])).toString();return {block:{number:block.number,hash:block.hash},frontier:{mIndex:mIndex.toString(),root:root.toString(),frontier}};}
export const HINKAL_LOG_PAGE_BLOCKS=50n;
export async function readHinkalCommitments(a:OnlineAdapter,from:bigint,to:bigint){
 if(from<0n||to<0n)throw Error('Invalid public commitment block range.');
 const leaves:{index:string,commitment:string}[]=[],topic=HINKAL_ABI.getEvent('NewCommitment')!.topicHash;
 for(let start=from;start<=to;start+=HINKAL_LOG_PAGE_BLOCKS){const limit=start+HINKAL_LOG_PAGE_BLOCKS-1n<to?start+HINKAL_LOG_PAGE_BLOCKS-1n:to,logs=await a.rpc('ethereum','eth_getLogs',[{address:HINKAL_PIN.ethereumContract,topics:[topic],fromBlock:'0x'+start.toString(16),toBlock:'0x'+limit.toString(16)}]);
  if(!Array.isArray(logs)||leaves.length+logs.length>1024)throw Error('Public Hinkal frontier catch-up exceeds this finite test window.');
  logs.sort((x:any,y:any)=>BigInt(x.blockNumber)<BigInt(y.blockNumber)?-1:BigInt(x.blockNumber)>BigInt(y.blockNumber)?1:Number(BigInt(x.logIndex)-BigInt(y.logIndex)));
  for(const l of logs){const block=BigInt(l.blockNumber);if(l.removed||getAddress(l.address)!==HINKAL_PIN.ethereumContract||block<start||block>limit)throw Error('Noncanonical Hinkal commitment log.');const e=HINKAL_ABI.parseLog(l)!;leaves.push({index:(e.args.index<0n?-e.args.index:e.args.index).toString(),commitment:e.args.commitment.toString()});}
 }
 return leaves;
}
export async function advanceHinkalWitness(a:OnlineAdapter,anchor:any,commitments:string[],tag='finalized'){await preProcessing();const snapshot=await captureHinkalFrontier(a,tag),canonical=await a.rpc('ethereum','eth_getBlockByNumber',[anchor.block.number,false]);if(canonical?.hash!==anchor.block.hash||BigInt(snapshot.block.number)<BigInt(anchor.block.number))throw Error('Captured Hinkal frontier became noncanonical.');const tree=bootstrapHinkalMerkle(anchor.frontier),leaves=await readHinkalCommitments(a,BigInt(anchor.block.number)+1n,BigInt(snapshot.block.number));
 appendHinkalMerkle(tree,leaves);if(tree.getIndex().toString()!==snapshot.frontier.mIndex||tree.getRootHash().toString()!==snapshot.frontier.root)throw Error('Public Hinkal leaves and independently read root disagree.');return {witness:makeHinkalLocalWitness(tree,commitments),anchor,snapshot,leaves};}
