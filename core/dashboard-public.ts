import { SOLANA_GENESIS } from './multi-protocol';
import {parseAppWallet,walletAccounts} from './app-wallet';
import {ETH_TOKENS,TOKEN} from './trade-protocol';
import {SOLANA_DASHBOARD_TOKENS} from './dashboard-tokens';
import {z} from 'zod';

const tokenAccountsSchema=z.object({value:z.array(z.object({
 pubkey:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
 account:z.object({owner:z.literal('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),executable:z.literal(false),data:z.object({
  program:z.literal('spl-token'),parsed:z.object({type:z.literal('account'),info:z.object({
   mint:z.string(),owner:z.string(),state:z.enum(['initialized','frozen']),
   tokenAmount:z.object({amount:z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine(v=>BigInt(v)<=18446744073709551615n),decimals:z.number().int()}),
  })}),
 })}),
})).max(256)});

export type DashboardBalance = { network: 'ethereum'|'robinhood'|'solana'; token?: string; symbol: string; name: string; decimals: number; quantity: string|null; updatedAt: string|null; error: string|null };
const dashboardRowSchema=z.object({network:z.enum(['ethereum','robinhood','solana']),token:z.string().min(1).max(64).optional(),address:z.string().min(1).max(64).optional(),symbol:z.string().min(1).max(20),name:z.string().min(1).max(100),decimals:z.number().int().min(0).max(36),quantity:z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(v=>BigInt(v)<2n**256n).nullable(),updatedAt:z.string().datetime().nullable(),error:z.string().min(1).max(300).nullable()});
// Validate presentation input before BigInt/formatUnits or state updates. This
// binds known display identities; it does not independently verify RPC balances.
export function parseDashboardBalances(input:unknown,wallet:unknown):DashboardBalance[]{
 const accounts=walletAccounts(parseAppWallet(wallet)),seen=new Set<string>();
 return z.array(dashboardRowSchema).min(1).max(32).parse(input).map(row=>{
  const account=accounts.find(a=>a.network===row.network);
  const same=(a:string,b:string)=>row.network==='solana'?a===b:a.toLowerCase()===b.toLowerCase();
  if(!account||(row.address&&!same(row.address,account.address)))throw Error('Balance account mismatch');
  const known=row.token?(row.network==='ethereum'?Object.entries(ETH_TOKENS):row.network==='solana'?Object.entries(SOLANA_DASHBOARD_TOKENS):[]).find(([,v])=>same(v.address,row.token!)):undefined;
  if(row.token?(!known||row.symbol!==known[0]||row.decimals!==known[1].decimals):(row.symbol!==(row.network==='solana'?'SOL':'ETH')||row.decimals!==(row.network==='solana'?9:18)))throw Error('Balance asset mismatch');
  const key=row.network+':'+(row.token?(row.network==='solana'?row.token:row.token.toLowerCase()):'native');
  if(seen.has(key)||(row.quantity!==null&&(!row.updatedAt||(row.network==='solana'&&BigInt(row.quantity)>18446744073709551615n)))||(row.quantity===null&&!row.error))throw Error('Invalid balance observation');
  seen.add(key);const {address,...balance}=row;return balance;
 });
}
export type PublicRpc = (network: DashboardBalance['network'], method: string, params: unknown[]) => Promise<unknown>;
export async function readDashboardBalances(input: unknown, rpc: PublicRpc): Promise<DashboardBalance[]> {
  const wallet = parseAppWallet(input);
  const accounts = walletAccounts(wallet);
  const rows: (Omit<DashboardBalance,'quantity'|'updatedAt'|'error'>&{address:string})[] = accounts.map(a=>({...a,symbol:a.network==='solana'?'SOL':'ETH',name:a.network==='robinhood'?'Robinhood Chain':a.network==='ethereum'?'Ethereum':'Solana',decimals:a.network==='solana'?9:18}));
  const ethereum = accounts.find(a=>a.network==='ethereum');
  if(ethereum) for(const symbol of ['WETH','USDC'] as const) rows.push({...ethereum,symbol,name:symbol==='WETH'?'Wrapped Ether':'USD Coin',token:ETH_TOKENS[symbol].address,decimals:ETH_TOKENS[symbol].decimals});
  const solana = accounts.find(a=>a.network==='solana');
  if(solana) for(const symbol of ['WETH','USDC'] as const){const token=SOLANA_DASHBOARD_TOKENS[symbol];rows.push({...solana,symbol,name:token.name,token:token.address,decimals:token.decimals});}
  return Promise.all(rows.map(async row => {
    try {
      let quantity: string;
      if (row.network === 'solana') {
        if (await rpc('solana','getGenesisHash',[]) !== SOLANA_GENESIS) throw Error('Wrong network');
        if(row.token){
          const result=tokenAccountsSchema.parse(await rpc('solana','getTokenAccountsByOwner',[row.address,{mint:row.token},{encoding:'jsonParsed',commitment:'finalized'}]));
          let total=0n;const seen=new Set<string>();
          for(const entry of result.value){
            const info=entry.account.data.parsed.info;
            if(seen.has(entry.pubkey)||info.mint!==row.token||info.owner!==row.address||info.tokenAmount.decimals!==row.decimals)throw Error('Unexpected token account');
            seen.add(entry.pubkey);total+=BigInt(info.tokenAmount.amount);
          }
          if(total>18446744073709551615n)throw Error('Invalid token balance');
          quantity=total.toString();
        }else{
          const result = await rpc('solana','getBalance',[row.address,{commitment:'finalized'}]) as {value?:unknown};
          if (!result || !Number.isSafeInteger(result.value) || (result.value as number) < 0) throw Error('Invalid balance');
          quantity=String(result.value);
        }
      } else {
        const identity=await rpc(row.network,'eth_chainId',[]);
        if (typeof identity!=='string' || !/^0x[0-9a-f]+$/i.test(identity) || BigInt(identity)!==BigInt(row.network==='ethereum'?1:4663)) throw Error('Wrong network');
        const result=row.token
          ? await rpc(row.network,'eth_call',[{to:row.token,data:TOKEN.encodeFunctionData('balanceOf',[row.address])},'latest'])
          : await rpc(row.network,'eth_getBalance',[row.address,'latest']);
        if(typeof result!=='string'||!(row.token?/^0x[0-9a-f]{64}$/i:/^0x[0-9a-f]{1,64}$/i).test(result))throw Error('Invalid balance');
        quantity=BigInt(result).toString();
      }
      return {...row,quantity,updatedAt:new Date().toISOString(),error:null};
    } catch { return {...row,quantity:null,updatedAt:null,error:'Balance unavailable. Refresh or check your RPC connection.'}; }
  }));
}
