export const LIFI_ASSETS = {
 'ethereum-eth': {chainId:1,network:'Ethereum',symbol:'ETH',decimals:18,address:'0x0000000000000000000000000000000000000000'},
 'ethereum-weth': {chainId:1,network:'Ethereum',symbol:'WETH',decimals:18,address:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'},
 'ethereum-usdc': {chainId:1,network:'Ethereum',symbol:'USDC',decimals:6,address:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'},
 'solana-sol': {chainId:1151111081099710,network:'Solana',symbol:'SOL',decimals:9,address:'11111111111111111111111111111111'},
 'solana-weth': {chainId:1151111081099710,network:'Solana',symbol:'WETH (Wormhole)',decimals:8,address:'7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'},
 'solana-usdc': {chainId:1151111081099710,network:'Solana',symbol:'USDC',decimals:6,address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'},
 'robinhood-eth': {chainId:4663,network:'Robinhood Chain',symbol:'ETH',decimals:18,address:'0x0000000000000000000000000000000000000000'},
 'base-eth': {chainId:8453,network:'Base',symbol:'ETH',decimals:18,address:'0x0000000000000000000000000000000000000000'},
 'base-usdc': {chainId:8453,network:'Base',symbol:'USDC',decimals:6,address:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'},
} as const;
export type LifiAssetKey=keyof typeof LIFI_ASSETS;
export type LifiCost={name:string;amount:string;symbol:string;chainId:number;address:string;included:boolean|null};
export type LifiQuote={provider:'LI.FI';quoteId:string;route:string;checkedAt:string;refreshAfterSeconds:60;from:LifiAssetKey;to:LifiAssetKey;fromAddress:string;toAddress:string;sendAmount:string;receiveAmount:string;minimumReceived:string;slippageBps:number;durationSeconds:number;fees:LifiCost[];gas:LifiCost[];signingEnabled:false;notice:string};
