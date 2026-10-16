import {ROBINHOOD_WETH_IDENTITY} from './robinhood-proxy-identity';
import {ETH_TOKENS} from './trade-protocol';
import {SOLANA_DASHBOARD_TOKENS} from './dashboard-tokens';
export function holdingMarketId(network:string,token?:string):string|null{
 if(!token)return network==='solana'?'solana':['ethereum','robinhood'].includes(network)?'ethereum':null;
 if(network==='ethereum'&&token.toLowerCase()===ETH_TOKENS.WETH.address.toLowerCase())return 'ethereum';
 if(network==='ethereum'&&token.toLowerCase()===ETH_TOKENS.USDC.address.toLowerCase())return 'usd-coin';
 if(network==='robinhood'&&token.toLowerCase()===ROBINHOOD_WETH_IDENTITY.token.toLowerCase())return 'ethereum';
 if(network==='solana')return Object.values(SOLANA_DASHBOARD_TOKENS).find(t=>t.address===token)?.marketId??null;
 return null;
}
