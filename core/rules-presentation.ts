import {formatUnits} from 'ethers';
import {rulesChanges,type RulesBundle,type RulesContext} from './rules-protocol';
export const RULE_CATEGORIES=['General','Software','Cloud services','Office','Travel','Food','Utilities','Education','Other'];
export const RULE_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const LIMIT_LABELS={perPayment:'Maximum per payment',rolling:'Daily allowance',sevenDay:'Seven-day budget',thirtyDay:'30-day budget',approvalAbove:'Ask for offline approval above',count:'Payments in any 24 hours'} as const;
const labels:Record<string,string>={...LIMIT_LABELS,agent:'Agent',approver:'Offline approver',guardian:'Emergency stop wallet',expires:'Rules expire',paused:'Spending stopped',weekdays:'Allowed days',startMinute:'Start UTC',endMinute:'End UTC',categories:'Allowed categories',category:'Category',recipient:'Recipient'};
export function tokenAmount(value:string|undefined,asset:'eth'|'usdg'){
 return value===undefined?'—':formatUnits(value,asset==='eth'?18:6).replace(/\.0$/,'');
}
export function maskNames(value:number,names:string[]){return names.filter((_,i)=>value&(1<<i)).join(', ')||'None';}
export function utcMinute(value:number){return `${Math.floor(value/60).toString().padStart(2,'0')}:${(value%60).toString().padStart(2,'0')}`;}
export function readableValue(key:string,value:unknown,asset?:'eth'|'usdg'):string{
 if(value===null||value===undefined)return 'Not set';
 if(typeof value==='object')return Object.entries(value).map(([k,v])=>`${labels[k]||k}: ${readableValue(k,v,k==='eth'||k==='usdg'?k:asset)}`).join('; ');
 if(key in LIMIT_LABELS&&key!=='count'&&asset)return `${tokenAmount(String(value),asset)} ${asset.toUpperCase()}`;
 if(key==='expires')return new Date(Number(value)*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
 if(key==='weekdays')return maskNames(Number(value),RULE_DAYS);
 if(key==='categories')return maskNames(Number(value),RULE_CATEGORIES);
 if(key==='category')return RULE_CATEGORIES[Number(value)]||String(value);
 if(key==='startMinute'||key==='endMinute')return utcMinute(Number(value));
 if(typeof value==='boolean')return value?'Yes':'No';
 return String(value);
}
export function readableChanges(before:RulesBundle|null,after:RulesBundle){return rulesChanges(before,after).map(c=>{
 const parts=c.field.split('.'),key=parts.at(-1)!,asset=parts.find(p=>p==='eth'||p==='usdg') as 'eth'|'usdg'|undefined;
 const prefix=parts[0]==='recipients'?`Recipient ${Number(parts[1])+1} · `:'';
 return {...c,label:prefix+(asset?asset.toUpperCase()+' · ':'')+(labels[key]||(/^\d+$/.test(key)?'Removed recipient':key)),beforeText:readableValue(key,c.before,asset),afterText:readableValue(key,c.after,asset)};
});}
export function remainingAllowance(context:RulesContext|null,usage:string[]|undefined,asset:'eth'|'usdg'){
 if(!context?.rules||!usage||usage.length<4)return undefined;
 const cap=context.rules[asset];
 const amounts=[BigInt(cap.rolling)-BigInt(usage[0]),BigInt(cap.sevenDay)-BigInt(usage[2]),BigInt(cap.thirtyDay)-BigInt(usage[3])];
 if(BigInt(usage[1])>=BigInt(cap.count)||context.paused||context.rules.paused||context.rules.expires<=Math.floor(Date.now()/1000))return '0';
 const minimum=amounts.reduce((a,b)=>a<b?a:b);return (minimum<0n?0n:minimum).toString();
}
export function historyLabel(status:string,outcome?:string){
 const action:Record<string,string>={'awaiting-offline-approval':'Approval requested','payment-confirmed':'Payment confirmed','policy-active':'Rules applied',stopped:'Spending stopped',reverted:'Transaction reverted'};
 const state:Record<string,string>={intent:'Preparing',signed:'Signed',unknown:'Outcome unknown — check evidence',submitted:'Submitted — awaiting confirmation',confirmed:'Confirmed — awaiting finality',finalized:'Finalized',failed:'Failed'};
 return [outcome?action[outcome]||outcome:'',state[status]||status].filter(Boolean).join(' · ');
}
