import QRCode from 'qrcode';
import {multiPublicSchema} from './engine/core/multi-protocol';
import {CHAINS,Chain} from './engine/core/payment-intent';
import {formatUnits} from 'ethers';
export async function makePaymentQR(input:unknown,params:any){
 const w=multiPublicSchema.parse(input);if(!params||!Object.hasOwn(CHAINS,params.chain)||!['ETH','SOL','USDC'].includes(params.asset)||typeof params.amount!=='string'||! /^[1-9][0-9]{0,37}$/.test(params.amount)||Object.keys(params).some(k=>!['chain','asset','amount'].includes(k)))throw Error('Invalid payment request.');
 const c=CHAINS[params.chain as Chain];if(params.asset!==c.native&&params.asset!=='USDC')throw Error('Asset and chain mismatch.');
 const address=c.family==='ethereum'?w.evmAddress:w.solanaAddress;
 const uri=c.family==='ethereum'?(params.asset==='ETH'?`ethereum:${address}@${(c as any).chainId}?value=${params.amount}`:`ethereum:${c.usdc}@${(c as any).chainId}/transfer?address=${address}&uint256=${params.amount}`):`solana:${address}?amount=${formatUnits(params.amount,params.asset==='USDC'?6:9)}${params.asset==='USDC'?'&spl-token='+c.usdc:''}`;
 return {uri,address,chain:params.chain,asset:params.asset,amount:params.amount,qr:await QRCode.toDataURL(uri,{width:256,margin:2})};
}
export type ReceiveNetwork='ethereum'|'solana';
export function receiveIdentity(input:unknown,network:unknown){
  const wallet=multiPublicSchema.parse(input);
  if(network==='ethereum')return {network:'Ethereum',asset:'ETH / ERC20',address:wallet.evmAddress,uri:'ethereum:'+wallet.evmAddress+'@1'};
  if(network==='solana')return {network:'Solana',asset:'SOL / SPL',address:wallet.solanaAddress,uri:'solana:'+wallet.solanaAddress};
  throw Error('Choose Ethereum or Solana.');
}
export async function makeReceiveInfo(input:unknown,network:unknown){
  const info=receiveIdentity(input,network);
  const qr=await QRCode.toDataURL(info.uri,{errorCorrectionLevel:'M',width:256,margin:2,color:{dark:'#101522',light:'#ffffff'}});
  return {...info,qr};
}
