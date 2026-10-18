// Display identities only; listing a holding does not enable a swap route.
// WETH mint/decimals: wormhole-foundation/wormhole-token-list, content/dest_solana.md.
export const SOLANA_DASHBOARD_TOKENS = {
 WETH: {address:'7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',decimals:8,name:'Wrapped Ether (Wormhole)',marketId:'ethereum-wormhole'},
 USDC: {address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',decimals:6,name:'USD Coin',marketId:'usd-coin'},
} as const;
