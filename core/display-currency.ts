import {parseUnits} from 'ethers';
import {z} from 'zod';
export const CURRENCIES={PLN:'Polish złoty',USD:'US dollar',EUR:'Euro',GBP:'British pound',CHF:'Swiss franc',JPY:'Japanese yen',CAD:'Canadian dollar',AUD:'Australian dollar'} as const;
export type DisplayCurrency=keyof typeof CURRENCIES;
export function isCurrency(value:unknown):value is DisplayCurrency{return typeof value==='string'&&Object.hasOwn(CURRENCIES,value);}
export type MarketPrice={rates:Partial<Record<DisplayCurrency,number>>;usd?:number;pln?:number;change:number|null;updatedAt:number};
const marketCoins=new Set(['bitcoin','ethereum','ethereum-wormhole','solana','usd-coin','chainlink','uniswap','aave','dai']);
const marketPriceSchema=z.object({rates:z.record(z.string(),z.number().finite().min(0).max(1e12)).refine(r=>Object.keys(r).length>0&&Object.keys(r).every(isCurrency)),change:z.number().finite().min(-100).max(1e12).nullable(),updatedAt:z.number().int().nonnegative().safe()});
export function parseMarketPrices(input:unknown,httpOk:boolean):Record<string,MarketPrice>{
 if(!httpOk)throw Error('Market data unavailable');
 const value=z.object({source:z.literal('CoinGecko'),prices:z.record(z.string(),marketPriceSchema)}).parse(input);
 if(Object.keys(value.prices).length>marketCoins.size||!Object.keys(value.prices).every(id=>marketCoins.has(id)))throw Error('Unknown market identity');
 return value.prices;
}
export function priceMicros(price:number|undefined):bigint|null {if(price===undefined||!Number.isFinite(price)||price<0||price>1e12)return null;return parseUnits(price.toFixed(6),6);}
export function holdingValue(quantity:string|null,decimals:number,price:number|undefined):bigint|null {const rate=priceMicros(price);return quantity===null||rate===null?null:BigInt(quantity)*rate/10n**BigInt(decimals);}
export function formatFiat(micros:bigint,currency:DisplayCurrency){
 const digits=currency==='JPY'?0:2,unit=10n**BigInt(6-digits),rounded=(micros+unit/2n)/unit,scale=10n**BigInt(digits),fraction=(rounded%scale).toString().padStart(digits,'0');
 return new Intl.NumberFormat(currency==='PLN'?'pl-PL':'en-US',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).formatToParts(rounded/scale).map(part=>part.type==='fraction'?fraction:part.value).join('');
}
export function freshAt(stamp:number|null|undefined,now:number){return typeof stamp==='number'&&Number.isFinite(stamp)&&stamp<=now+60000&&now-stamp<300000;}
