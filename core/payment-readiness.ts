// Per-path acceptance. Publishing the website and executing an agent payment are separate approvals.
import {ROBINHOOD_WETH_IDENTITY,ROBINHOOD_USDG_IDENTITY} from './robinhood-proxy-identity';
export const PAYMENT_PATHS = {
 'robinhood-native': {enabled:true,dependency:'Exact fresh preflight and explicit offline-approved submission required'},
 'robinhood-erc20': {enabled:false,dependency:'Reviewed standard-token identities and exact-delivery acceptance; arbitrary contracts are not certified'},
 'robinhood-weth': {enabled:true,dependency:'RC10 v6 implementation-bound approval; only the pinned canonical WETH contract is eligible'},
 'robinhood-usdg': {enabled:true,dependency:'RC11 v6 implementation-bound approval; only the pinned canonical USDG contract is eligible'},
 'ethereum-payment': {enabled:true,dependency:'RC12 v7 required; native ETH and pinned WETH/USDC identities, exact fresh preflight and explicit submission'},
 'ethereum-swap': {enabled:true,dependency:'RC12 v7 required; pinned WETH/USDC single pools at 500 or 3000, exact allowance, minimum output, expiry and fresh preflight'},
 'solana-native': {enabled:true,dependency:'An initialized funded nonce owned by the offline wallet is required'},
 'solana-spl': {enabled:true,dependency:'Classic SPL only; an initialized funded nonce and exact token/account checks required'},
 'solana-swap-sol-usdc': {enabled:true,dependency:'Only pinned direct Raydium CLMM routes; exact fresh preflight, initialized nonce and explicit offline-approved submission required'},
 'solana-swap-usdc-sol': {enabled:true,dependency:'Only pinned direct Raydium CLMM routes; exact fresh preflight, initialized nonce and explicit offline-approved submission required'},
 'solana-nonce-setup': {enabled:false,dependency:'Retired online-sponsor route; use the verified offline nonce setup with RC9'},
 'solana-offline-nonce': {enabled:true,dependency:'RC9 ISO required; funded offline wallet, valid original blockhash, exact preflight and explicit submission'},
 'husher': {enabled:false,dependency:'Authenticated key permissions, canonical route checks and a new provider-bound offline approval format'},
} as const;
export type PaymentPath=keyof typeof PAYMENT_PATHS;
export function pathForRequest(input:unknown):PaymentPath|null{
 if(!input||typeof input!=='object')return null;
 const r=input as Record<string,unknown>;
 if(r.version===2&&r.chainId===4663)return 'robinhood-native';
 if(r.version===6&&r.network==='robinhood'&&r.standard==='erc20'&&typeof r.token==='string'&&r.token.toLowerCase()===ROBINHOOD_WETH_IDENTITY.token.toLowerCase())return 'robinhood-weth';
 if(r.version===6&&r.network==='robinhood'&&r.standard==='erc20'&&typeof r.token==='string'&&r.token.toLowerCase()===ROBINHOOD_USDG_IDENTITY.token.toLowerCase())return 'robinhood-usdg';
 if((r.version===3||r.version===6)&&r.network==='robinhood'&&r.standard==='erc20')return 'robinhood-erc20';
 if(r.version===3&&r.network==='solana')return r.standard==='native'?'solana-native':r.standard==='spl'?'solana-spl':null;
 // Legacy v4 remains readable for recovery; it cannot inherit v7 execution acceptance.
 if(r.version===7&&r.network==='ethereum')return r.kind==='payment'?'ethereum-payment':r.kind==='swap'||r.kind==='approval'?'ethereum-swap':null;
 if(r.version===4&&r.network==='solana'&&r.kind==='swap'){
  const build=r.build as Record<string,unknown>|undefined;
  if(build?.inputMint==='So11111111111111111111111111111111111111112'&&build.outputMint==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')return 'solana-swap-sol-usdc';
  if(build?.inputMint==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'&&build.outputMint==='So11111111111111111111111111111111111111112')return 'solana-swap-usdc-sol';
 }
 return null;
}
export function paymentExecutionEnabled(input:unknown){const path=pathForRequest(input);return path!==null&&PAYMENT_PATHS[path].enabled;}





