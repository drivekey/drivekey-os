import {getAddress,keccak256} from 'ethers';
import {z} from 'zod';
import type {Rpc} from './protocol';

// Reviewed mainnet identities; never learn or accept replacements from an RPC response.
// Evidence: work/ethereum-private/{read-only,contract-identities}.json, 2026-09-28.
export const ETHEREUM_IDENTITIES={
 WETH:{address:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',codeHash:'0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23'},
 USDC:{address:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',codeHash:'0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505',implementationSlot:'0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',implementation:'0x43506849d7c04f9138d1a2050bbf3a0c054402dd',implementationCodeHash:'0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea'},
 Router:{address:'0xE592427A0AEce92De3Edee1F18E0157C05861564',codeHash:'0xbb90113d2f9a5e9b7feb15a1d1fff06c1ee1575b3f9b1181778ffd0cf633e7ea'},
 Quoter:{address:'0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',codeHash:'0xd7efd86e5c3f85370d1100907ab446b24a996ad245172f44efec6a20f9ba70e6'},
 Factory:{address:'0x1F98431c8aD98523631AE4a59f267346ea31F984',codeHash:'0x4d7b8525cd5d14343fa67a732fba5b24cddba11620ca88392f4ec6c52f91fd69'},
 Pool500:{address:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',codeHash:'0xa981b66c747a3d9fa29d7e200d5faaa2826960523d0e5a0df8148e8868c480b4'},
 Pool3000:{address:'0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',codeHash:'0xf2b8b58f95b1471751302e520a0e7c410ce9846ed46020be253dbd25fbb6da11'},
} as const;
const digest=z.string().regex(/^0x[0-9a-f]{64}$/);
const address=z.string().refine(v=>{try{return getAddress(v)!=='0x0000000000000000000000000000000000000000';}catch{return false;}});
export const ethereumIdentitySchema=z.object({name:z.enum(['WETH','USDC','Router','Quoter','Factory','Pool500','Pool3000']),address,codeHash:digest,implementationSlot:digest.optional(),implementation:address.optional(),implementationCodeHash:digest.optional()}).strict();
export type EthereumIdentity=z.infer<typeof ethereumIdentitySchema>;
type Action={kind:'payment'|'approval'|'swap';tokenIn:'ETH'|'WETH'|'USDC';poolFee:500|3000};
export function ethereumIdentitiesFor(a:Action):EthereumIdentity[]{
 const names:Array<keyof typeof ETHEREUM_IDENTITIES>=a.kind==='swap'?['WETH','USDC','Router','Quoter','Factory',a.poolFee===500?'Pool500':'Pool3000']:a.tokenIn==='ETH'?[]:a.kind==='approval'?[a.tokenIn,'Router']:[a.tokenIn];
 return names.map(name=>({name,...ETHEREUM_IDENTITIES[name]}));
}
export function validateEthereumIdentities(a:Action,input:unknown):EthereumIdentity[]{
 const actual=z.array(ethereumIdentitySchema).max(7).parse(input),expected=ethereumIdentitiesFor(a);
 const fields=['name','address','codeHash','implementationSlot','implementation','implementationCodeHash'] as const;
 if(actual.length!==expected.length||actual.some((pin,i)=>fields.some(k=>pin[k]!==expected[i][k])))throw Error('Unsupported Ethereum contract identities. Obtain a reviewed signer update.');
 return actual;
}
const isHash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v);
function hashCode(code:unknown){
 if(typeof code!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)||code.length>100_000)throw Error('Missing or invalid Ethereum contract code.');
 return keccak256(code);
}
export async function checkEthereumIdentities(rpc:Rpc,a:Action,approved:unknown){
 const identities=validateEthereumIdentities(a,approved);
 if(await rpc('eth_chainId')!=='0x1')throw Error('Wrong Ethereum network.');
 const block=await rpc('eth_getBlockByNumber',['latest',false]) as {number?:unknown;hash?:unknown}|null;
 if(!block||typeof block.number!=='string'||!/^0x[0-9a-fA-F]+$/.test(block.number)||!isHash(block.hash))throw Error('Missing Ethereum identity block.');
 await Promise.all(identities.map(async pin=>{
  if(hashCode(await rpc('eth_getCode',[pin.address,block.number]))!==pin.codeHash)throw Error('Ethereum contract code changed. Submission blocked pending review.');
  if(pin.implementation){
   const word=await rpc('eth_getStorageAt',[pin.address,pin.implementationSlot,block.number]);
   if(!isHash(word)||!/^0x0{24}[0-9a-fA-F]{40}$/.test(word)||'0x'+word.slice(-40).toLowerCase()!==pin.implementation.toLowerCase())throw Error('USDC implementation changed. Submission blocked pending review.');
   if(hashCode(await rpc('eth_getCode',[pin.implementation,block.number]))!==pin.implementationCodeHash)throw Error('USDC implementation code changed. Submission blocked pending review.');
  }
 }));
 const canonical=await rpc('eth_getBlockByNumber',[block.number,false]) as {hash?:unknown}|null;
 if(!canonical||canonical.hash!==block.hash)throw Error('Ethereum identity block changed. Repeat fresh preflight.');
 return {blockNumber:block.number,blockHash:block.hash};
}
