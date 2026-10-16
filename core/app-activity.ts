import {formatEther,formatUnits} from 'ethers';
import {readManualSession,MANUAL_SESSION} from './manual-session';
import {multiPublicSchema,validateMultiRequest} from './multi-protocol';
import {validateTrade} from './trade-protocol';
import {validateSolSwap} from './sol-swap-protocol';
export type ActivityRow={id:string;network:string;kind:string;state:string;createdAt:string|null;wallet:string;amount?:string;hash?:string;href:string};
export function savedActivityState(state:string){
 if(state==='prepared')return 'Saved request · not sent';
 if(state==='signed'||state==='verified-only')return 'Saved signature · not sent';
 if(state==='confirmed'||state==='finalized')return 'Saved confirmation · recheck receipt';
 if(state==='failed'||state==='reverted'||state==='expired')return 'Saved failure · review';
 if(['submitting','submitted','pending','unknown','not-seen'].includes(state))return 'Submission recorded · check receipt';
 return 'Saved record · review';
}
export function localActivity(storage:Pick<Storage,'getItem'>){const rows:ActivityRow[]=[],errors:string[]=[];
 function read(key:string,fn:(raw:string)=>void){const raw=storage.getItem(key);if(!raw)return;try{if(raw.length>2000000)throw Error();fn(raw);}catch{errors.push('A saved '+key+' record could not be read. Its original data is preserved.');}}
 read(MANUAL_SESSION,raw=>{const s=readManualSession(raw);rows.push({id:s.request.requestId,network:'robinhood',kind:'Send',state:s.attempt?.state||'prepared',createdAt:s.request.createdAt,wallet:s.wallet.address,amount:formatEther(s.request.value)+' ETH',hash:s.attempt?.hash,href:'/app/manual'});});
 read('drivekey-payments-rc-v1',raw=>{const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>100)throw Error();for(const r of records){const w=multiPublicSchema.parse(r.wallet);const request=r.network==='ethereum'?validateTrade(r.request,Date.now(),false):r.kind==='swap'?validateSolSwap(r.request,Date.now(),false):validateMultiRequest(r.request,Date.now(),false);if(r.id!==request.requestId||request.deviceId!==w.deviceId||typeof r.state!=='string'||r.state.length>50)throw Error();const data=request as unknown as Record<string,unknown>;rows.push({id:request.requestId,network:r.network,kind:r.kind==='swap'?'Swap':r.kind==='approval'?'Token approval':'Send',state:r.state,createdAt:request.createdAt,wallet:r.network==='solana'?w.solanaAddress:w.evmAddress,amount:typeof data.amount==='string'&&typeof data.decimals==='number'?formatUnits(data.amount,data.decimals):undefined,hash:typeof r.response?.transactionHash==='string'?r.response.transactionHash:undefined,href:(r.kind==='payment'?'/app/send':'/app/swap')+'?restore='+encodeURIComponent(r.id)});}});
 read('drivekey-multi-experimental-v3',raw=>{const s=JSON.parse(raw),w=multiPublicSchema.parse(s.wallet),r=validateMultiRequest(s.request,Date.now(),false);if(r.deviceId!==w.deviceId)throw Error();rows.push({id:r.requestId,network:r.network,kind:'Token transfer',state:'prepared',createdAt:r.createdAt,wallet:r.from,amount:formatUnits(r.amount,r.decimals),href:'/app/assets'});});
 read('drivekey-agent-activity-v1',raw=>{const items=JSON.parse(raw);if(!Array.isArray(items)||items.length>100)throw Error();for(const v of items){if(!v||typeof v.id!=='string'||!v.id||v.id.length>200||typeof v.state!=='string'||v.state.length>100||typeof v.wallet!=='string'||!/^0x[0-9a-f]{40}$/i.test(v.wallet)||v.kind!=='Agent rules'||(v.hash!==undefined&&v.hash!==null&&(typeof v.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(v.hash))))throw Error();rows.push({id:v.id,state:v.state,wallet:v.wallet,kind:'Agent rules',...(v.hash?{hash:v.hash}:{}),network:'robinhood',createdAt:null,href:'/app/agents'});}});
 return {rows:rows.map(row=>({...row,state:savedActivityState(row.state)})),errors};
}
export async function journalActivity():Promise<ActivityRow[]>{
 if(!globalThis.indexedDB)return [];
 if(indexedDB.databases&&!(await indexedDB.databases()).some(d=>d.name==='drivekey-submission-journal-v1'))return [];
 return new Promise((resolve,reject)=>{const opened=indexedDB.open('drivekey-submission-journal-v1');opened.onupgradeneeded=()=>{opened.transaction?.abort();resolve([]);};opened.onerror=()=>resolve([]);opened.onsuccess=()=>{const db=opened.result;if(!db.objectStoreNames.contains('attempts')){db.close();resolve([]);return;}const tx=db.transaction('attempts','readonly'),cursor=tx.objectStore('attempts').openCursor(),rows:ActivityRow[]=[];cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;const v=item.value,key=item.key;if(Array.isArray(key)&&typeof key[0]==='string'&&typeof v?.hash==='string'&&typeof v.state==='string'&&rows.length<200){const index=key[0].indexOf(':'),network=key[0].slice(0,index),wallet=key[0].slice(index+1);rows.push({id:v.hash,hash:v.hash,network,wallet,kind:'Submission',state:v.state,createdAt:null,href:network==='robinhood'?'/app/manual':'/app/send'});}item.continue();};tx.oncomplete=()=>{db.close();resolve(rows.map(row=>({...row,state:savedActivityState(row.state)})));};tx.onerror=()=>{db.close();reject(Error('Submission journal unavailable.'));};};});
}
