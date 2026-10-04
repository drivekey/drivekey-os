import {z} from 'zod';
import {getAddress} from 'ethers';
import {ETH_TOKENS} from './trade-protocol';
const network=z.object({network:z.string(),sendStatus:z.boolean(),receiveStatus:z.boolean(),hasTag:z.boolean(),receiveDecimals:z.number().int().min(0).max(18),contractAddress:z.string().nullish()});
const catalog=z.array(z.object({currency:z.string(),networkList:z.array(network).max(200)})).max(2000);
// Husher receiveDecimals is provider precision, not the token's on-chain decimals.
// Only canonical identities are recognized; ticker names alone never qualify.
export function inspectHusherAssets(raw:unknown){
 const rows=catalog.parse(raw);
 const select=(currency:string,chain:string)=>{
  const currencies=rows.filter(x=>x.currency===currency);if(currencies.length!==1)throw Error('Missing or ambiguous currency.');
  const matches=currencies[0].networkList.filter(x=>x.network===chain);if(matches.length!==1)throw Error('Missing or ambiguous network.');
  const n=matches[0];if(n.hasTag||!n.sendStatus||!n.receiveStatus)throw Error('Asset route unavailable.');return n;
 };
 const eth=select('ETH','ETH'),usdc=select('USDC','ETH');
 if(eth.contractAddress||!usdc.contractAddress||getAddress(usdc.contractAddress)!==ETH_TOKENS.USDC.address||usdc.receiveDecimals!==6)throw Error('Husher currency identities differ from supported Ethereum assets.');
 return {route:'eth-usdc' as const,network:'ethereum' as const,chainId:1,sendAsset:'ETH',sendChainDecimals:18,receiveAsset:'USDC',receiveChainDecimals:6,receiveContract:ETH_TOKENS.USDC.address,
  providerReceivePrecision:eth.receiveDecimals,metadataMatched:true,ordersEnabled:false,privacyEnabled:false};
}
