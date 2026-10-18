import {publicWallet,metadataSchema, type PublicWallet} from './protocol';
import {multiPublicSchema, type MultiPublic} from './multi-protocol';
import {parseStrictPublicJson} from './strict-public-json';
export type AppWallet = PublicWallet | MultiPublic;
export type AccountNetwork = 'robinhood' | 'ethereum' | 'solana';
export const NETWORK_NAMES: Record<AccountNetwork,string> = {robinhood:'Robinhood Chain',ethereum:'Ethereum mainnet',solana:'Solana mainnet'};
export function parseAppWallet(value:unknown):AppWallet {
  if (JSON.stringify(value)?.length > 4096) throw Error('Public wallet file is too large.');
  const parsed=metadataSchema.safeParse(value);if(parsed.success)return publicWallet(parsed.data);
  const multi=multiPublicSchema.safeParse(value);if(multi.success)return multi.data;
  throw Error('Choose wallet-public.json or wallet-multi-public.json exported by DriveKey. Never import a vault or private key.');
}
export function isMultiWallet(wallet:AppWallet|null):wallet is MultiPublic {return wallet?.version===3;}
export function walletAccounts(wallet:AppWallet|null):{network:AccountNetwork;address:string}[]{
  if(!wallet)return [];
  if(!isMultiWallet(wallet))return [{network:'robinhood',address:wallet.address}];
  return [{network:'robinhood',address:wallet.evmAddress},{network:'ethereum',address:wallet.evmAddress},{network:'solana',address:wallet.solanaAddress}];
}
export function walletKey(wallet:AppWallet|null){return wallet?JSON.stringify(wallet):'';}
export function parseAppWalletText(text:string):AppWallet{return parseAppWallet(parseStrictPublicJson(text,4096));}
export async function readPublicWalletFile(file:File){
 if(file.size>4096)throw Error('Public wallet file exceeds 4 KB. Do not select your encrypted vault.');
 const bytes=await file.arrayBuffer();if(bytes.byteLength>4096)throw Error('Public wallet file exceeds 4 KB.');
 // Preserve BOM for explicit rejection; never replace malformed UTF-8 silently.
 return parseAppWalletText(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
}
