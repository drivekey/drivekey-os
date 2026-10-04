import { multiPublicSchema, SOLANA_GENESIS } from './multi-protocol';
import {parseAppWallet,walletAccounts} from './app-wallet';

export type DashboardBalance = { network: 'ethereum'|'robinhood'|'solana'; symbol: string; name: string; decimals: number; quantity: string|null; updatedAt: string|null; error: string|null };
export type PublicRpc = (network: DashboardBalance['network'], method: string, params: unknown[]) => Promise<unknown>;
export async function readDashboardBalances(input: unknown, rpc: PublicRpc): Promise<DashboardBalance[]> {
  const wallet = parseAppWallet(input);
  const rows = walletAccounts(wallet).map(a=>({...a,symbol:a.network==='solana'?'SOL':'ETH',name:a.network==='robinhood'?'Robinhood Chain':a.network==='ethereum'?'Ethereum':'Solana',decimals:a.network==='solana'?9:18}));
  return Promise.all(rows.map(async row => {
    try {
      let quantity: string;
      if (row.network === 'solana') {
        if (await rpc('solana','getGenesisHash',[]) !== SOLANA_GENESIS) throw Error('Wrong network');
        const result = await rpc('solana','getBalance',[row.address,{commitment:'finalized'}]) as {value?:unknown};
        if (!result || !Number.isSafeInteger(result.value) || (result.value as number) < 0) throw Error('Invalid balance');
        quantity=String(result.value);
      } else {
        const identity=await rpc(row.network,'eth_chainId',[]);
        if (typeof identity!=='string' || !/^0x[0-9a-f]+$/i.test(identity) || BigInt(identity)!==BigInt(row.network==='ethereum'?1:4663)) throw Error('Wrong network');
        const result=await rpc(row.network,'eth_getBalance',[row.address,'latest']);
        if(typeof result!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(result))throw Error('Invalid balance');
        quantity=BigInt(result).toString();
      }
      return {...row,quantity,updatedAt:new Date().toISOString(),error:null};
    } catch { return {...row,quantity:null,updatedAt:null,error:'Balance unavailable. Refresh or check your RPC connection.'}; }
  }));
}
