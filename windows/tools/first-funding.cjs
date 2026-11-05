'use strict';
// Public online controller. No vault, password or private credential is read here.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),{Transaction,parseUnits}=require('ethers');
const {OnlineAdapter}=require('../dist/adapter.cjs'),{SettlementVerifier}=require('../dist/checkout-verifier.cjs'),{CheckoutService}=require('../dist/checkout-service.cjs'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),output=path.resolve(root,'../../outputs'),session=JSON.parse(fs.readFileSync(path.resolve(root,'../session-public.json'))).sessionId;
const endpoints=['https://eth-pokt.nodies.app','https://eth.rpc.blxrbdn.com'];
function profile(job){const p=spawnSync(process.execPath,[path.join(root,'tools/protected-test-profile.cjs')],{input:JSON.stringify({...job,sessionId:session}),encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});let r;try{r=JSON.parse(p.stdout);}catch{throw Error('Protected signer returned no valid response.');}if(p.status||!r.ok)throw Error(r.error||'Protected signer refused.');return r.result;}
function save(name,data){fs.mkdirSync(output,{recursive:true});const file=path.join(output,name),tmp=file+'.tmp',fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
async function prices(){
 const coinbase='https://api.coinbase.com/v2/prices/ETH-USD/spot',coingecko='https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
 const values=await Promise.all([coinbase,coingecko].map(async url=>{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Fresh valuation unavailable.');return r.json();}));
 const up=value=>{const s=String(value);if(!/^\d+(\.\d+)?$/.test(s))throw Error('Malformed price.');const [whole,fraction='']=s.split('.');return BigInt(whole)*1000000n+BigInt((fraction+'000000').slice(0,6))+(fraction.slice(6).match(/[1-9]/)?1n:0n);};
 const a=up(values[0].data.amount),b=up(values[1].ethereum.usd),maximum=a>b?a:b;if(maximum===0n||(a>b?a-b:b-a)*100n>maximum*2n)throw Error('Independent prices disagree by more than 2%.');
 return {observedAt:Date.now(),sources:[coinbase,coingecko],nativeUsdMicros:maximum.toString(),assetUsdMicros:maximum.toString(),quotes:values};
}
async function run(){const submit=process.argv.includes('--submit'),reconcileOnly=process.argv.includes('--reconcile');if(process.argv.slice(2).some(a=>!['--submit','--reconcile'].includes(a))||(submit&&reconcileOnly))throw Error('Unsupported first-funding mode.');
 const status=profile({action:'status'}),identity=status.identity;
 const configuredFunding=process.env.DRIVEKEY_LEGACY_FUNDING_DIRECTORY;
 if(!configuredFunding||!path.isAbsolute(configuredFunding))throw Error('Set DRIVEKEY_LEGACY_FUNDING_DIRECTORY to an authorized local funding directory.');
 const original=JSON.parse(fs.readFileSync(path.join(process.env.DRIVEKEY_LEGACY_FUNDING_DIRECTORY || '', 'PROVISIONING-RECEIPT.json'))).public;
 if(original.evmAddress!=='0xFEA3f1c9Fe066aEEf4Ec4CE18DCc3aF2B2621ADD')throw Error('Original funding source changed.');
 const adapters=endpoints.map(endpoint=>new OnlineAdapter({ethereum:endpoint})),verifiers=adapters.map(a=>new SettlementVerifier(a));
 const db=new PGlite(path.resolve(root,'../acceptance-merchant-db'));try{
  const exists=await db.query("SELECT to_regclass('public.invoices') AS name");if(!exists.rows[0].name)await db.exec(fs.readFileSync(path.join(root,'merchant/schema.sql'),'utf8'));
  const checkout=new CheckoutService(db,async(invoice,hash)=>{const both=await Promise.all(verifiers.map(v=>v.verify(invoice,hash))),normalize=e=>e.map(({chain,asset,recipient,amount,transactionHash,eventIndex,chainTime,canonical,proof})=>({chain,asset,recipient,amount,transactionHash,eventIndex,chainTime,canonical,blockHash:proof.blockHash,blockNumber:proof.blockNumber}));if(JSON.stringify(normalize(both[0]))!==JSON.stringify(normalize(both[1])))throw Error('Independent merchant settlement disagreement.');return both[0].map((e,n)=>({...e,proof:{...e.proof,independent:both[1][n].proof}}));});
  await checkout.provision('ethereum',[identity.source.evmAddress]);const invoice=await checkout.create({chain:'ethereum',asset:'ETH',amount:'500000000000000',expiresInSeconds:86400},'acceptance-first-funding-eth-01');save('FIRST-FUNDING-INVOICE.json',invoice);
  const existing=status.ledger.operations.find(o=>o.routeId==='first-funding-eth');let record;
  if(existing){record=profile({action:'recovery-record',fingerprint:existing.fingerprint});if(submit)throw Error('Existing signed funding intent must only be reconciled.');}
  else{
   if(reconcileOnly)throw Error('No funding signature exists to reconcile.');
   const request=await adapters[0].prepare({chain:'ethereum',asset:'ETH',amount:invoice.amount,recipient:invoice.address},original);await Promise.all(adapters.map(a=>a.preflight(request)));
   const valuation=await prices(),source=await (await import('./fingerprint.mjs')).fingerprint(root),tx=Transaction.from(request.unsignedTransaction),balance=await adapters[0].balance('ethereum',original.evmAddress,'ETH');
   const manifest={version:1,kind:'disposable-funding-authorization',sessionId:session,sourceFingerprint:source.fingerprint,routeId:'first-funding-eth',request,requestFingerprint:request.fingerprint,source:request.from,destination:request.recipient,chainId:1,tokenContract:'native',contractTarget:tx.to,spender:null,operations:['fund-controlled-test-source','pay-preexisting-controlled-ETH-invoice'],exactInput:request.amount,minimumOutput:request.amount,nonce:tx.nonce,deadline:request.expiresAt,maximumFee:request.maximumFee,slippageBps:0,invoiceId:invoice.id,valuation,simulation:{passed:true,fingerprint:request.fingerprint,observedAt:Date.now(),endpoints},nativeBalance:balance.native,nativeReserve:'1000000000000000',binaryHashes:Object.fromEntries(['worker.cjs','online-worker.cjs','adapter.cjs','checkout-verifier.cjs'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,'dist',name))).digest('hex')])),stopConditions:['uncertain-broadcast','unexpected-permission','unverifiable-state','failed-simulation','missing-signer','stale-valuation','budget-breach','nonce-conflict','expired-intent','independent-provider-disagreement']};
   save('FIRST-FUNDING-MANIFEST.json',manifest);
   if(!submit){console.log(JSON.stringify({prepared:true,signed:false,submitted:false,sourceAccess:!!identity.fundingSource,source:request.from,destination:request.recipient,amountWei:request.amount,maximumFeeWei:request.maximumFee,invoiceId:invoice.id}));return;}
   if(!identity.fundingSource)throw Error('Run the local hidden-input Unlock-Test-Funding.cmd step; no usable signing access to the funded source exists.');
   profile({action:'qualify-source'});profile({action:'sign-funding',manifest});record=profile({action:'recovery-record',fingerprint:request.fingerprint});await Promise.all(adapters.map(a=>a.preflight(record.request)));
   record=profile({action:'take-submission',fingerprint:request.fingerprint});
   // The one-time gate is consumed BEFORE this only possible network send.
   try{await adapters[0].broadcast(record.request,record.response);}catch{save('FIRST-FUNDING-STATUS.json',{state:'uncertain',transactionHash:record.response.transactionHash,automaticRetry:false});throw Error('Funding submission uncertain. Preserve reservation; reconcile the exact hash only.');}
  }
  const observations=await Promise.all(adapters.map(async(a,index)=>{const result=await a.reconcile(record.request,record.response);return {endpoint:endpoints[index],...result,transactionHash:record.response.transactionHash};}));
  save('FIRST-FUNDING-STATUS.json',{checkedAt:new Date().toISOString(),observations,transactionHash:record.response.transactionHash,automaticRetry:false});
  if(observations.every(o=>o.state==='confirmed')){const merchantReceipt=await checkout.observe(invoice.public_token,record.response.transactionHash);if(merchantReceipt.status!=='paid')throw Error('Funding invoice did not reconcile to paid.');save('FIRST-FUNDING-MERCHANT-RECEIPT.json',merchantReceipt);const settled=profile({action:'record-settlement',fingerprint:record.request.fingerprint,observations});save('SPENDING-LEDGER.json',profile({action:'status'}).ledger);console.log(JSON.stringify({state:settled.state,transactionHash:settled.transactionHash,merchant:merchantReceipt.status,actualUsdMicros:settled.actualUsdMicros}));}
  else console.log(JSON.stringify({state:'pending-or-uncertain',transactionHash:record.response.transactionHash,observations:observations.map(o=>o.state),automaticRetry:false}));
 }finally{await db.close();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
