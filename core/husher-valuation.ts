import 'server-only';
import {Interface,parseUnits} from 'ethers';
import type {Rpc} from './protocol';
// Public Chainlink Ethereum mainnet ETH/USD reference feed, directory checked 2026-09-29.
export const HUSHER_ETH_USD_FEED='0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const feed=new Interface(['function decimals() view returns(uint8)','function description() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
const quantity=(v:unknown)=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]+$/.test(v))throw Error('Invalid valuation evidence.');return BigInt(v);};
export async function husherVolumeReservation(maximumSendAmount:string,rpc:Rpc,now=Date.now()){
 const wei=parseUnits(maximumSendAmount,18);if(wei<=0n||wei>10n**19n)throw Error('Unsupported volume amount.');
 if(quantity(await rpc('eth_chainId'))!==1n)throw Error('Wrong valuation network.');
 const block=await rpc('eth_getBlockByNumber',['latest',false]) as {hash?:string;number?:string;timestamp?:string}|null;
 if(!block?.hash||!/^0x[0-9a-fA-F]{64}$/.test(block.hash)||!block.number||Math.abs(Number(quantity(block.timestamp))*1000-now)>120000)throw Error('Stale valuation block.');
 const call=async(name:string)=>feed.decodeFunctionResult(name,String(await rpc('eth_call',[{to:HUSHER_ETH_USD_FEED,data:feed.encodeFunctionData(name)},block.number])));
 const [decimals,description,round]=await Promise.all([call('decimals'),call('description'),call('latestRoundData')]);
 const [roundId,answer,startedAt,updatedAt,answeredInRound]=round;
 if(decimals[0]!==8n||description[0]!=='ETH / USD'||answer<=0n||answer>10000000000000n||roundId<=0n||answeredInRound<roundId||startedAt<=0n||updatedAt<startedAt||updatedAt>BigInt(Math.floor(now/1000)+30)||BigInt(Math.floor(now/1000))-updatedAt>3600n)throw Error('Invalid or stale USD price.');
 const final=await rpc('eth_getBlockByNumber',[block.number,false]) as {hash?:string}|null;if(final?.hash!==block.hash)throw Error('Valuation block changed.');
 // Reserve both legs conservatively plus 10%, rounded upward to USD micro-units.
 // Re-evaluate before submission; an increase beyond the saved reservation blocks sending.
 const numerator=wei*answer*22n,denominator=10n**21n;
 const reserved=(numerator+denominator-1n)/denominator;
 if(reserved<=0n||reserved>1000000000n)throw Error('Order exceeds the authorized monthly allowance.');
 return {usdMicros:reserved.toString(),feed:HUSHER_ETH_USD_FEED,roundId:roundId.toString(),answer:answer.toString(),updatedAt:updatedAt.toString(),blockHash:block.hash,blockNumber:block.number};
}
