'use strict';
// Test-only authority. Never shipped or selected by CLI JSON/environment.
const {createHash}=require('node:crypto');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const versions=new Set([8,9,10,11,12,14,22,23]);
function exactFixturePolicy(request,wallet,{sourceFingerprint,now=Date.now()}={}) {
  if(!versions.has(request?.version)||!wallet?.deviceId||request.deviceId!==wallet.deviceId||!sourceFingerprint||!/^[a-f0-9]{64}$/.test(sourceFingerprint))throw Error('Invalid unfunded execution scope.');
  const requestHash=digest(request),walletHash=digest(wallet),expires=now+60000;
  let signed=false;
  const allowedIntent=value=>digest(value)===requestHash&&Date.now()<=expires;
  const deny=()=>{throw Error('Unfunded transaction scope cannot authorize private capabilities or proofs.');};
  return Object.freeze({allowedIntent,assertIntent(value,context){
    if(!allowedIntent(value))throw Error('Unfunded request scope changed or expired.');
    if(context){if(!['review','sign'].includes(context.action)||digest(context.wallet)!==walletHash)throw Error('Unfunded wallet/action scope changed.');if(context.action==='sign'){if(signed)throw Error('Unfunded signing authority was already consumed.');signed=true;}}
  },assertPrivateView:deny,assertProductProof:deny});
}
module.exports={exactFixturePolicy,digest};
