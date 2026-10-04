import {getAddress,parseUnits} from 'ethers';
import {validateTrade,SWAP_ROUTER} from './trade-protocol';
import {validateSolSwap} from './sol-swap-protocol';
import {validateMultiRequest,type MultiPublic} from './multi-protocol';
import {SOL_USDC} from './payment-request';

export function checkPreparedMultiIntent(input:unknown,intent:{wallet:MultiPublic;network:'robinhood'|'solana';token:string;recipient:string;amount:string;nonceAccount:string}){
 const r=validateMultiRequest(input),a=intent;
 const equal=(x:string,y:string)=>a.network==='robinhood'?getAddress(x)===getAddress(y):x===y;
 if(r.network!==a.network||r.deviceId!==a.wallet.deviceId||!equal(r.from,a.network==='robinhood'?a.wallet.evmAddress:a.wallet.solanaAddress)||!equal(r.recipient,a.recipient)||!equal(r.token,a.token)||r.amount!==parseUnits(a.amount,r.decimals).toString()||(r.network==='solana'&&r.nonceAccount!==a.nonceAccount))throw Error('Prepared request differs from the selected wallet, network, token, recipient, amount or nonce.');
 return r;
}

// Compare the server result to the form snapshot before saving/exporting it.
export function checkPreparedIntent(input:unknown,intent:{wallet:MultiPublic;network:'ethereum'|'solana';kind:'payment'|'swap'|'approval';asset:string;amount:string;recipient:string;nonce:string;slippage:number}){
 const a=intent,units=parseUnits(a.amount,a.asset==='USDC'?6:a.network==='solana'?9:18).toString();
 const fail=()=>{throw Error('Prepared request differs from the selected wallet, network, asset, amount or recipient.');};
 if(a.network==='ethereum'){
  const r=validateTrade(input),recipient=a.kind==='swap'?a.wallet.evmAddress:a.kind==='approval'?SWAP_ROUTER:a.recipient;
  if(r.deviceId!==a.wallet.deviceId||getAddress(r.from)!==getAddress(a.wallet.evmAddress)||r.kind!==a.kind||r.tokenIn!==a.asset||r.amount!==units||getAddress(r.recipient)!==getAddress(recipient)||a.kind==='swap'&&r.slippageBps!==a.slippage)fail();
  return r;
 }
 if(a.kind==='swap'){
  const r=validateSolSwap(input);
  if(r.deviceId!==a.wallet.deviceId||r.from!==a.wallet.solanaAddress||r.nonceAccount!==a.nonce||r.build.inputMint!==(a.asset==='SOL'?'So11111111111111111111111111111111111111112':SOL_USDC)||r.build.inAmount!==units||r.build.slippageBps!==a.slippage)fail();
  return r;
 }
 const r=validateMultiRequest(input);
 if(a.kind!=='payment'||r.network!=='solana'||r.deviceId!==a.wallet.deviceId||r.from!==a.wallet.solanaAddress||r.recipient!==a.recipient||r.amount!==units||r.token!==(a.asset==='SOL'?'native':SOL_USDC)||r.nonceAccount!==a.nonce)fail();
 return r;
}
