export function publicRpcUrl(network:'ethereum'|'robinhood'|'solana'){
 return network==='ethereum'?(process.env.ETHEREUM_RPC_URL||'https://ethereum-rpc.publicnode.com'):network==='robinhood'?(process.env.ROBINHOOD_RPC_URL||'https://rpc.mainnet.chain.robinhood.com'):(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
}
