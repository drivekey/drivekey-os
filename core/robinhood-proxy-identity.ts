import {getAddress, keccak256} from 'ethers';
import type {Rpc} from './protocol';

// A prerequisite for this known proxy, not a general token acceptance list.
export const ROBINHOOD_WETH_IDENTITY = {
  token:'0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  proxyCodeHash:'0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353',
  implementation:'0xc6b81b429797e0f555440b70cd99e032d7ae947e',
  implementationCodeHash:'0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650',
  decimals:18,signer:'RC10',symbol:'WETH',
} as const;
export const ROBINHOOD_USDG_IDENTITY={
 token:'0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
 proxyCodeHash:'0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6',
 implementation:'0x68184c449e1a8f34fa18d289737129fd27b66f8f',
 implementationCodeHash:'0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf',
 decimals:6,signer:'RC11',symbol:'USDG',
} as const;
export function robinhoodTokenIdentity(token:string){
 let address:string;try{address=getAddress(token);}catch{return null;}
 return [ROBINHOOD_WETH_IDENTITY,ROBINHOOD_USDG_IDENTITY].find(pin=>pin.token===address)??null;
}
export const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v);
function codeHash(code:unknown) {
  if(typeof code!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)||code.length>100_000)throw Error('Unsupported proxy implementation code.');
  return keccak256(code);
}
export function verifyRobinhoodWethIdentity(proxyHash:string, implementation:string, implementationHash:string) {
  verifyRobinhoodTokenIdentity(ROBINHOOD_WETH_IDENTITY.token,proxyHash,implementation,implementationHash);
}
export function verifyRobinhoodTokenIdentity(token:string,proxyHash:string,implementation:string,implementationHash:string){
  const pin=robinhoodTokenIdentity(token);if(!pin)throw Error('Unsupported Robinhood token identity.');
  if(proxyHash!==pin.proxyCodeHash||implementation.toLowerCase()!==pin.implementation||implementationHash!==pin.implementationCodeHash)
    throw Error(`Robinhood ${pin.symbol} proxy implementation changed or is unsupported. Submission remains blocked pending review.`);
}
export async function checkKnownRobinhoodProxy(rpc:Rpc, token:string) {
  if(!robinhoodTokenIdentity(token))return null;
  if(await rpc('eth_chainId')!=='0x1237')throw Error('Wrong Robinhood network.');
  const block=await rpc('eth_getBlockByNumber',['latest',false]) as {number?:unknown;hash?:unknown}|null;
  if(!block||typeof block.number!=='string'||!/^0x[0-9a-fA-F]+$/.test(block.number)||!hash(block.hash))throw Error('Missing proxy identity block.');
  const [word,proxyCode]=await Promise.all([rpc('eth_getStorageAt',[token,IMPLEMENTATION_SLOT,block.number]),rpc('eth_getCode',[token,block.number])]);
  if(!hash(word)||!/^0x0{24}[0-9a-fA-F]{40}$/.test(word))throw Error('Invalid proxy implementation slot.');
  const implementation='0x'+word.slice(-40);
  const implementationCodeHash=codeHash(await rpc('eth_getCode',[implementation,block.number]));
  verifyRobinhoodTokenIdentity(token,codeHash(proxyCode),implementation,implementationCodeHash);
  const canonical=await rpc('eth_getBlockByNumber',[block.number,false]) as {hash?:unknown}|null;
  if(!canonical||canonical.hash!==block.hash)throw Error('Proxy identity block changed. Repeat fresh preflight.');
  return {blockNumber:block.number,blockHash:block.hash,implementation,implementationCodeHash};
}
