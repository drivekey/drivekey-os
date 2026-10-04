import {ROBINHOOD_WETH_IDENTITY} from './robinhood-proxy-identity';
export function holdingMarketId(network:string,token?:string):string|null{
 if(!token)return network==='solana'?'solana':['ethereum','robinhood'].includes(network)?'ethereum':null;
 if(network==='robinhood'&&token.toLowerCase()===ROBINHOOD_WETH_IDENTITY.token.toLowerCase())return 'ethereum';
 if(network==='solana'&&token==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')return 'usd-coin';
 return null;
}
