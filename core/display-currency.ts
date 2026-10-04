import {parseUnits} from 'ethers';
export const CURRENCIES={PLN:'Polish złoty',USD:'US dollar',EUR:'Euro',GBP:'British pound',CHF:'Swiss franc',JPY:'Japanese yen',CAD:'Canadian dollar',AUD:'Australian dollar'} as const;
export type DisplayCurrency=keyof typeof CURRENCIES;
export function isCurrency(value:unknown):value is DisplayCurrency{return typeof value==='string'&&Object.hasOwn(CURRENCIES,value);}
export type MarketPrice={rates:Partial<Record<DisplayCurrency,number>>;usd?:number;pln?:number;change:number|null;updatedAt:number};
export function priceMicros(price:number|undefined):bigint|null {if(price===undefined||!Number.isFinite(price)||price<0||price>1e12)return null;return parseUnits(price.toFixed(6),6);}
export function holdingValue(quantity:string|null,decimals:number,price:number|undefined):bigint|null {const rate=priceMicros(price);return quantity===null||rate===null?null:BigInt(quantity)*rate/10n**BigInt(decimals);}
export function formatFiat(micros:bigint,currency:DisplayCurrency){
 const digits=currency==='JPY'?0:2,unit=10n**BigInt(6-digits),rounded=(micros+unit/2n)/unit,scale=10n**BigInt(digits),fraction=(rounded%scale).toString().padStart(digits,'0');
 return new Intl.NumberFormat(currency==='PLN'?'pl-PL':'en-US',{style:'currency',currency,minimumFractionDigits:digits,maximumFractionDigits:digits}).formatToParts(rounded/scale).map(part=>part.type==='fraction'?fraction:part.value).join('');
}
export function freshAt(stamp:number|null|undefined,now:number){return typeof stamp==='number'&&Number.isFinite(stamp)&&stamp<=now+60000&&now-stamp<300000;}
