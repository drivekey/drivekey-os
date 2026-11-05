'use strict';
// Public catalog identities only. No activation, vault read, signing or journal writes.
const PAIRS=Object.freeze([['ethereum','ETH'],['ethereum','USDC'],['solana','SOL'],['solana','USDC']]);
function createAccountBalanceReader({getWallets,online,isOffline,now=Date.now}){
 const cache=new Map();
 const identify=w=>JSON.stringify([w.deviceId,w.evmAddress,w.solanaAddress]);
 const read = async (input, signal) => {
  signal?.throwIfAborted();
  if(isOffline())throw Error('Account networking is disabled in the offline companion.');
  if(!input||Object.keys(input).length!==1||typeof input.id!=='string'||!/^[-0-9a-f]{36}$/i.test(input.id))throw Error('Choose a catalog account.');
  const wallet=getWallets().find(w=>w.id===input.id);if(!wallet)throw Error('Choose a catalog account.');
  const identity=identify(wallet),key=input.id+'|'+identity,saved=cache.get(key);
  if(saved&&now()-saved.at<45000)return structuredClone(saved.value);
  const balances=[];
  for(const [chain,asset]of PAIRS){signal?.throwIfAborted();let value;
   try{const r=await online({action:'observed-balance',chain,asset,from:chain==='ethereum'?wallet.evmAddress:wallet.solanaAddress},signal);if(r&&(r.chain===undefined||r.chain===chain)&&(r.asset===undefined||r.asset===asset)&&typeof r.amount==='string'&&/^\d{1,80}$/.test(r.amount))value=r.amount;}catch{}
   signal?.throwIfAborted();
   const current=getWallets().find(w=>w.id===input.id);if(!current||identify(current)!==identity)throw Error('The account changed during the balance read.');
   const old=saved?.value.balances.find(b=>b.chain===chain&&b.asset===asset);
   balances.push({chain,asset,...value!==undefined?{amount:value,stale:false,observedAt:new Date(now()).toISOString()}:old?.amount!==undefined?{amount:old.amount,stale:true,observedAt:old.observedAt}:{stale:true}});
  }
  const value={accountId:input.id,observedAt:new Date(now()).toISOString(),balances};
  cache.set(key,{at:now(),value});for(const k of cache.keys())if(!getWallets().some(w=>k===w.id+'|'+identify(w)))cache.delete(k);
  return structuredClone(value);
 };
 read.clear = () => cache.clear();
 return read;
}
module.exports={createAccountBalanceReader,PAIRS};
