// Browser-only persistence and cross-tab exclusion. No network or signing operations.
import type {TradeAttempt} from './trade-submission';
export type AttemptStore={read():Promise<TradeAttempt|null>;write(value:TradeAttempt):Promise<void>};
const DB='drivekey-submission-journal-v1';
const terminal=(s:TradeAttempt['state'])=>['confirmed','failed','expired'].includes(s);
function checked(value:unknown):TradeAttempt{
 const v=value as TradeAttempt;
 if(!v||typeof v!=='object'||typeof v.hash!=='string'||!(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/).test(v.hash)||!/^0x[0-9a-f]{64}$/.test(v.fingerprint)||!['unknown','submitted','confirmed','failed','expired'].includes(v.state))throw Error('Submission journal is damaged. Recovery is required.');
 return {hash:v.hash,fingerprint:v.fingerprint,state:v.state};
}
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{
 const r=indexedDB.open(DB,1);let failed=false;
 r.onupgradeneeded=()=>{r.result.createObjectStore('attempts');r.result.createObjectStore('active');};
 r.onerror=()=>reject(r.error||Error('Submission storage unavailable.'));
 r.onblocked=()=>{failed=true;reject(Error('Submission storage upgrade is blocked by another tab.'));};
 r.onsuccess=()=>{if(failed){r.result.close();return;}r.result.onversionchange=()=>r.result.close();resolve(r.result);};
});}
export async function withTradeJournal<T>(scope:string,hash:string,fingerprint:string,operation:(store:AttemptStore)=>Promise<T>):Promise<T>{
 if(!/^((?:ethereum|robinhood):0x[0-9a-f]{40}|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(scope))throw Error('Invalid wallet/network journal scope.');
 checked({hash,fingerprint,state:'unknown'});
 if(!globalThis.isSecureContext||!navigator.locks||!globalThis.indexedDB)throw Error('Secure browser locking and durable storage are required.');
 return navigator.locks.request('drivekey-submit:'+scope,{mode:'exclusive'},async()=>{
  const db=await open();let live=true;
  const store:AttemptStore={
   read:()=>new Promise((resolve,reject)=>{
    if(!live){reject(Error('Submission lock is no longer held.'));return;}
    const tx=db.transaction('attempts','readonly'),r=tx.objectStore('attempts').get([scope,hash]);let value:TradeAttempt|null=null;
    r.onsuccess=()=>{try{value=r.result===undefined?null:checked(r.result);if(value&&(value.hash!==hash||value.fingerprint!==fingerprint))throw Error('Journal request identity mismatch.');}catch(e){reject(e);tx.abort();}};
    tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('Submission journal read failed.'));
   }),
   write:value=>new Promise<void>((resolve,reject)=>{
    try{
     if(!live)throw Error('Submission lock is no longer held.');
     const next=checked(value);if(next.hash!==hash||next.fingerprint!==fingerprint)throw Error('Journal request identity mismatch.');
     const tx=db.transaction(['attempts','active'],'readwrite',{durability:'strict'}),attempts=tx.objectStore('attempts'),active=tx.objectStore('active');
     const fail=(error:unknown)=>{reject(error);tx.abort();};
     tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error('Submission intent was not durably committed.'));
     const own=attempts.get([scope,hash]);
     own.onsuccess=()=>{try{
      const previous=own.result===undefined?null:checked(own.result);
      if(previous&&(previous.hash!==hash||previous.fingerprint!==fingerprint))throw Error('Journal request identity mismatch.');
      if(previous&&['confirmed','failed'].includes(previous.state)&&previous.state!==next.state)throw Error('Finalized attempt cannot change state.');
      const pointer=active.get(scope);
      pointer.onsuccess=()=>{
       const commit=(replaceActive:boolean)=>{attempts.put(next,[scope,hash]);if(replaceActive)active.put(hash,scope);};
       if(pointer.result===undefined||pointer.result===hash){commit(true);return;}
       const other=attempts.get([scope,pointer.result]);
       other.onsuccess=()=>{try{
        const current=checked(other.result);
        if(previous&&terminal(previous.state)){if(!terminal(next.state))throw Error('Cannot reopen an archived attempt.');commit(false);return;}
        if(!terminal(current.state))throw Error('Another transaction must be reconciled before submitting.');
        commit(true);
       }catch(e){fail(e);}};
      };
     }catch(e){fail(e);}};
    }catch(e){reject(e);}
   }),
  };
  try{return await operation(store);}finally{live=false;db.close();}
 });
}
