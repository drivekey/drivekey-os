import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {OnlineAdapter} from './adapter';
const {programs:pins}=require('../vendor/jupiter/program-pins.json');
// Reuse a verified code hash only within one minute and from a strictly later
// bank with the identical loader header. Loader-v3 rewrites the deployment slot
// on every upgrade; header/size/pointer changes therefore invalidate the proof.
const verifiedExecutableCache=new Map<string,{header:string;slot:number;verifiedAt:number}>();
const publicReadSchedule=new Map<string,number>();
// Bind program bytes to the bank used by a separate state/receipt observation.
// A stale account response must not reuse a once-valid executable cache entry.
export async function verifySolanaProgramsAtSlot(a:OnlineAdapter,addresses:string[],additionalPins:any[],minimumSlot:number){
 if(!Number.isSafeInteger(minimumSlot)||minimumSlot<1)throw Error('Invalid minimum executable observation slot.');let last=minimumSlot;const guarded=Object.create(a) as OnlineAdapter;
 guarded.rpc=async(chain,method,params)=>{if(chain!=='solana'||!['getMultipleAccounts','getAccountInfo'].includes(method)||!Array.isArray(params)||params.length!==2||!params[1]||typeof params[1]!=='object')throw Error('Executable slot verification permits bounded public account reads only.');const prior=params[1].minContextSlot;if(prior!==undefined&&(!Number.isSafeInteger(prior)||prior<0))throw Error('Invalid executable account context.');const minimum=Math.max(last,prior??0),result=await a.rpc(chain,method,[params[0],{...params[1],minContextSlot:minimum}]);if(!Number.isSafeInteger(result?.context?.slot)||result.context.slot<minimum)throw Error('Solana executable context predates the required observation.');last=result.context.slot;return result;};
 return verifySolanaPrograms(guarded,addresses,additionalPins);
}
// Full executable bytes are hashed in bounded chunks, with the deployment header
// checked again afterwards to detect an upgrade during the read.
export async function verifySolanaPrograms(a:OnlineAdapter,addresses:string[],additionalPins:any[]=[]){
 // Only public account reads may retry transient rate limits or a lagging RPC
 // node. Financial submissions never pass through this helper.
 const read=async(method:string,params:any[]):Promise<any>=>{if(!['getMultipleAccounts','getAccountInfo'].includes(method))throw Error('Executable verification permits account reads only.');for(let attempt=0;;attempt++){const endpoint=a.endpoints.solana;if(endpoint?.startsWith('https://')){const next=Math.max(Date.now(),(publicReadSchedule.get(endpoint)||0)+350);publicReadSchedule.set(endpoint,next);const delay=next-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));}try{return await a.rpc('solana',method,params);}catch(error){if(attempt>=3||!(error instanceof Error)||!/HTTP 429|code -32016/.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}}};
 // Public RPCs can enforce a smaller per-call account limit than the chain.
 // These are executable identity observations; each program's deployment is
 // subsequently read and hashed independently, with before/after header checks.
 const infoValues:any[]=[];for(let offset=0;offset<addresses.length;offset+=10){const batch=addresses.slice(offset,offset+10),part=await read('getMultipleAccounts',[batch,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:45}}]);if(!Array.isArray(part.value)||part.value.length!==batch.length)throw Error('Missing Solana account identities.');infoValues.push(...part.value);}const verified:string[]=[];
 for(let i=0;i<addresses.length;i++){
  const info=infoValues[i],pin=[...pins,...additionalPins].find((p:any)=>p.address===addresses[i]);
  if(!info?.executable||info.owner==='NativeLoader1111111111111111111111111111111'){
   if(pin)throw Error('Pinned Solana executable is missing or not executable.');
   continue;
  }
  if(info.executable!==true||!pin||info.owner!==pin.loader)throw Error('Unpinned executable in Solana route.');const firstBytes=Buffer.from(info.data[0],'base64'),upgradeable=info.owner==='BPFLoaderUpgradeab1e11111111111111111111111';
  if(upgradeable&&(firstBytes.readUInt32LE(0)!==2||new PublicKey(firstBytes.subarray(4,36)).toBase58()!==pin.programData))throw Error('Solana program-data identity changed.');
  const first=await read('getAccountInfo',[pin.programData,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:45}}]);if(first.value?.space!==pin.space||first.value.owner!==pin.loader||(upgradeable&&(Buffer.from(first.value.data[0],'base64').readUInt32LE(0)!==3||Buffer.from(first.value.data[0],'base64').readBigUInt64LE(4).toString()!==pin.deployedSlot)))throw Error('Solana executable deployment changed.');
  if(!Number.isSafeInteger(first.context?.slot)||first.context.slot<1)throw Error('Missing executable verification bank.');
  const cacheKey=JSON.stringify([a.endpoints.solana,pin.address,pin.loader,pin.programData,pin.space,pin.deployedSlot,pin.programDataSha256]),cached=verifiedExecutableCache.get(cacheKey);
  if(upgradeable&&cached&&Date.now()-cached.verifiedAt<=60000&&first.context.slot>cached.slot&&BigInt(pin.deployedSlot)<BigInt(cached.slot)&&first.value.data[0]===cached.header){verified.push(pin.address);continue;}
  const hash=createHash('sha256');for(let offset=0;offset<pin.space;offset+=524288){const length=Math.min(524288,pin.space-offset),chunk=await read('getAccountInfo',[pin.programData,{encoding:'base64',commitment:'confirmed',minContextSlot:first.context.slot,dataSlice:{offset,length}}]),bytes=Buffer.from(chunk.value?.data?.[0]||'','base64');if(bytes.length!==length||chunk.value.space!==pin.space||chunk.value.owner!==pin.loader)throw Error('Solana executable snapshot changed.');hash.update(bytes);}
  const last=await read('getAccountInfo',[pin.programData,{encoding:'base64',commitment:'confirmed',minContextSlot:first.context.slot,dataSlice:{offset:0,length:45}}]);if(last.value?.owner!==pin.loader||last.value.space!==pin.space||!Number.isSafeInteger(last.context?.slot)||last.context.slot<first.context.slot||last.value.data[0]!==first.value.data[0]||hash.digest('hex')!==pin.programDataSha256)throw Error('Pinned Solana executable hash changed.');
  if(upgradeable&&Number.isSafeInteger(last.context?.slot)&&last.context.slot>=first.context.slot){if(verifiedExecutableCache.size>=128)verifiedExecutableCache.delete(verifiedExecutableCache.keys().next().value!);verifiedExecutableCache.set(cacheKey,{header:last.value.data[0],slot:last.context.slot,verifiedAt:Date.now()});}
  verified.push(pin.address);
 }
 return verified;
}
