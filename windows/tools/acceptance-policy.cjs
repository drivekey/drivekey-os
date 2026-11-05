'use strict';
// Disposable acceptance profile only. Integer USD millionths, rounded UP per debit.
const {createHash}=require('node:crypto');
const {independent}=require('./independent-sources.cjs');
const LIMIT=29970000n, ROUTE_LIMIT=5000000n, FEE_LIMIT=1000000n;
const uint=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(v))throw Error('Invalid integer units.');return BigInt(v);};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function cost(units,price,decimals){if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid decimals.');const d=10n**BigInt(decimals);return (uint(units)*uint(price)+d-1n)/d;}
function authorizePayment(manifest,state,identity,validatePayment,now=Date.now()){
 if(manifest.version!==1||manifest.kind!=='disposable-payment-authorization'||manifest.sessionId!==state.sessionId||manifest.sourceFingerprint!==state.sourceFingerprint)throw Error('Wrong acceptance scope or source.');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(manifest.routeId)||!Array.isArray(manifest.stopConditions)||!manifest.stopConditions.includes('uncertain-broadcast'))throw Error('Missing route or stop conditions.');
 const r=validatePayment(manifest.request,now);
 if(!['ethereum','solana'].includes(r.chain))throw Error('Mainnet acceptance profile requires exact supported chain.');
 const recipient=r.asset==='USDC'?(identity.tokenRecipient||identity.recipient):identity.recipient;
 const source=r.network==='ethereum'?identity.source.evmAddress:identity.source.solanaAddress,target=r.network==='ethereum'?recipient.evmAddress:recipient.solanaAddress;
 const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&(r.network==='ethereum'?a.toLowerCase()===b.toLowerCase():a===b);
 if(r.deviceId!==identity.source.deviceId||!same(r.from,source)||!same(r.recipient,target))throw Error('Payment must use the isolated controlled test wallets.');
 if(manifest.requestFingerprint!==r.fingerprint||manifest.minimumOutput!==r.amount||manifest.slippageBps!==0||manifest.tokenContract!==(r.asset==='USDC'?identity.usdc[r.chain]:'native'))throw Error('Manifest differs from exact payment.');
 if(state.operations.some(o=>o.fingerprint===r.fingerprint)||state.operations.some(o=>o.state!=='settled'&&o.state!=='cancelled-before-signing')||state.permissions?.length)throw Error('Duplicate, unresolved funded operation or remaining token permission.');
 const v=manifest.valuation;
 if(!v||!Number.isSafeInteger(v.observedAt)||now-v.observedAt>120000||v.observedAt>now||!independent(v.sources))throw Error('Fresh independent valuations required.');
 if(manifest.simulation?.passed!==true||manifest.simulation.fingerprint!==r.fingerprint||!Number.isSafeInteger(manifest.simulation.observedAt)||now-manifest.simulation.observedAt>60000||manifest.simulation.observedAt>now)throw Error('Fresh exact-intent simulation required.');
 const decimals=r.asset==='USDC'?6:r.network==='ethereum'?18:9,nativeDecimals=r.network==='ethereum'?18:9;
 if(uint(v.nativeUsdMicros)===0n||uint(v.assetUsdMicros)===0n)throw Error('Zero valuation.');
 if(r.asset!=='USDC'&&v.nativeUsdMicros!==v.assetUsdMicros)throw Error('Inconsistent native valuation.');
 const fee=cost(r.maximumFee,v.nativeUsdMicros,nativeDecimals),reserve=cost(r.amount,v.assetUsdMicros,decimals)+fee+cost(r.accountRent,v.nativeUsdMicros,nativeDecimals);
 const used=state.operations.filter(o=>o.state!=='cancelled-before-signing').reduce((s,o)=>s+uint(o.actualUsdMicros??o.reservedUsdMicros),0n);
 const route=state.operations.filter(o=>o.routeId===manifest.routeId&&o.state!=='cancelled-before-signing').reduce((s,o)=>s+uint(o.actualUsdMicros??o.reservedUsdMicros),0n);
 if(fee>FEE_LIMIT||reserve+route>ROUTE_LIMIT||used+reserve>LIMIT)throw Error('Acceptance spending ceiling exceeded.');
 if(uint(manifest.nativeBalance)<uint(r.maximumFee)+uint(r.accountRent)+(r.asset==='USDC'?0n:uint(r.amount))+uint(manifest.nativeReserve))throw Error('Native reserve would be consumed.');
 if(uint(manifest.nativeReserve)<uint(r.maximumFee))throw Error('Native reserve must retain at least one approved network fee.');
 return {fingerprint:r.fingerprint,routeId:manifest.routeId,reservedUsdMicros:reserve.toString(),manifestHash:digest(manifest),state:'reserved',reservedAt:new Date(now).toISOString()};
}
function authorizeFunding(manifest,state,identity,validatePayment,now=Date.now()){
 if(manifest.kind!=='disposable-funding-authorization'||!identity.fundingSource||manifest.request.chain!=='ethereum'||manifest.request.asset!=='ETH')throw Error('Existing disposable funding access required.');
 const op=authorizePayment({...manifest,kind:'disposable-payment-authorization'},state,{...identity,source:identity.fundingSource,recipient:identity.source},validatePayment,now);
 const committed=uint(state.fundingCommittedUsdMicros);
 if(!Number.isSafeInteger(state.additionalFundingTransfers)||state.additionalFundingTransfers<0)throw Error('Verified funding history required.');
 const additional=manifest.additionalFundingAuthorization;
 if(additional==='SECOND-ETH-TOPUP-AUTHORIZATION.json'){
  if(manifest.caseId!=='ethereum-gas-topup-2'||manifest.request.amount!=='1000000000000000'||manifest.fundingCeilingUsdMicros!=='10000000'||uint(manifest.priorFundingGrossUsdMicros)!==committed||!(/^[0-9a-f]{64}$/).test(manifest.fundingExtensionGrantSHA256||''))throw Error('Funding differs from the separately approved second ETH top-up.');
  if(state.additionalFundingTransfers!==1||uint(op.reservedUsdMicros)>2500000n||committed+uint(op.reservedUsdMicros)>10000000n)throw Error('Second ETH top-up authorization exhausted or exceeded.');
 }else if(additional!==undefined){
  if(additional!=='ETHEREUM-TOPUP-AUTHORIZATION.json'||manifest.caseId!=='ethereum-gas-topup'||manifest.request.amount!=='1500000000000000'||manifest.fundingCeilingUsdMicros!=='7500000'||uint(manifest.priorFundingGrossUsdMicros)!==committed)throw Error('Funding differs from the one approved ETH top-up.');
  if(state.additionalFundingTransfers!==0||uint(op.reservedUsdMicros)>3500000n||committed+uint(op.reservedUsdMicros)>7500000n)throw Error('One-time ETH top-up authorization exhausted or exceeded.');
 }else if(committed+uint(op.reservedUsdMicros)>4000000n){
  throw Error('Initial combined funding ceiling exceeded.');
 }
 op.manifestHash=digest(manifest);return op;
}
function authorizeOperation(manifest,state,identity,validators,now=Date.now()){
 if(manifest.kind==='disposable-swap-authorization'&&manifest.request?.version===11)return authorizeSolanaSwap(manifest,state,identity,validators,now);
 const swap=manifest.kind==='disposable-swap-authorization',hinkal=manifest.kind==='disposable-hinkal-authorization',lifi=swap&&manifest.request?.version===12;
 if(!swap&&!hinkal)throw Error('Unsupported disposable operation authorization.');
 const r=(lifi?validators.validateLifiEvm:swap?validators.validateSwap:validators.validateHinkal)(manifest.request,now),{Transaction,getAddress}=require('ethers'),tx=Transaction.from(r.unsignedTransaction);
 if(manifest.version!==1||manifest.sessionId!==state.sessionId||manifest.sourceFingerprint!==state.sourceFingerprint||r.deviceId!==identity.source.deviceId||getAddress(r.from)!==getAddress(identity.source.evmAddress)||r.chain!=='ethereum'||r.network!=='ethereum')throw Error('Wrong signing source, release or chain.');
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(manifest.routeId)||state.operations.some(o=>o.fingerprint===r.fingerprint||!['settled','cancelled-before-signing'].includes(o.state)))throw Error('Duplicate or unresolved operation.');
 const owned=[identity.source,identity.recipient,identity.tokenRecipient].filter(Boolean).map(w=>getAddress(w.evmAddress));if(!owned.includes(getAddress(r.recipient)))throw Error('Output must use a controlled test recipient.');
 const asset=swap?r.tokenIn:r.asset,approval=['approve','revoke','hinkal-approve','hinkal-revoke'].includes(r.action),revoke=['revoke','hinkal-revoke'].includes(r.action),spender=lifi?validators.lifiRouter:swap?validators.uniswapRouter:validators.hinkalContract,canonicalAsset=asset==='USDC'?identity.usdc.ethereum:'native';
 const minimum=approval?'0':swap?r.minimumOutput:r.amount,slippage=swap?r.slippageBps:0;
 if(manifest.requestFingerprint!==r.fingerprint||manifest.source!==r.from||getAddress(manifest.destination)!==getAddress(r.recipient)||manifest.chainId!==1||getAddress(manifest.contractTarget)!==tx.to||getAddress(manifest.spender)!==getAddress(spender)||manifest.tokenContract!==canonicalAsset||manifest.exactInput!==r.amount||manifest.minimumOutput!==minimum||manifest.slippageBps!==slippage||manifest.nonce!==tx.nonce||manifest.deadline!==r.expiresAt||manifest.maximumFee!==r.maximumFee)throw Error('Public authorization differs from exact signed intent.');
 const permissions=state.permissions||[];if(permissions.length&&(!permissions.every(p=>p.routeId===manifest.routeId&&getAddress(p.spender)===getAddress(spender))||(!revoke&&(approval||asset!=='USDC'||permissions.some(p=>p.amount!==r.amount)))))throw Error('Resolve the exact existing allowance before unrelated spending.');
 const v=manifest.valuation,s=manifest.simulation;
 if(!v||!Number.isSafeInteger(v.observedAt)||now-v.observedAt>120000||v.observedAt>now||!independent(v.sources)||uint(v.nativeUsdMicros)===0n||uint(v.assetUsdMicros)===0n)throw Error('Fresh independent valuations required.');
 if(asset==='ETH'&&v.nativeUsdMicros!==v.assetUsdMicros)throw Error('Native valuation mismatch.');
 if(!s||s.passed!==true||s.fingerprint!==r.fingerprint||!Number.isSafeInteger(s.observedAt)||now-s.observedAt>60000||s.observedAt>now||!independent(s.endpoints))throw Error('Two fresh exact-intent simulations required.');
 if(swap&&r.action==='swap'&&(!Number.isSafeInteger(manifest.quoteObservedAt)||now-manifest.quoteObservedAt>60000||manifest.quoteObservedAt>now))throw Error('Swap quote is stale.');
 if(!Array.isArray(manifest.stopConditions)||!manifest.stopConditions.includes('uncertain-broadcast'))throw Error('Missing stop conditions.');
 // Aggregator AMM fees are embedded in the route. Bound all of its input as a
 // conservative fee ceiling instead of trusting an incomplete provider fee list.
 const networkFee=cost(r.maximumFee,v.nativeUsdMicros,18),poolFee=swap&&r.action==='swap'?cost(lifi?r.amount:((uint(r.amount)*BigInt(r.poolFee)+999999n)/1000000n).toString(),v.assetUsdMicros,asset==='USDC'?6:18):0n,fee=networkFee+poolFee,reserve=cost(r.amount,v.assetUsdMicros,asset==='USDC'?6:18)+networkFee;
 const used=state.operations.filter(o=>o.state!=='cancelled-before-signing').reduce((n,o)=>n+uint(o.actualUsdMicros??o.reservedUsdMicros),0n),route=state.operations.filter(o=>o.routeId===manifest.routeId&&o.state!=='cancelled-before-signing').reduce((n,o)=>n+uint(o.actualUsdMicros??o.reservedUsdMicros),0n);
 if(fee>FEE_LIMIT||route+reserve>ROUTE_LIMIT||used+reserve>LIMIT)throw Error('Operation or aggregate spending ceiling exceeded.');
 if(uint(manifest.nativeReserve)<uint(r.maximumFee)||uint(manifest.nativeBalance)<BigInt(tx.value)+uint(r.maximumFee)+uint(manifest.nativeReserve))throw Error('Native gas reserve would be consumed.');
 return {fingerprint:r.fingerprint,routeId:manifest.routeId,sourceFingerprint:state.sourceFingerprint,reservedUsdMicros:reserve.toString(),manifestHash:digest(manifest),state:'reserved',reservedAt:new Date(now).toISOString(),permission:approval?{spender,amount:r.amount,revocation:revoke}:undefined};
}
function authorizeSolanaSwap(m,state,identity,validators,now){
 const r=validators.validateLifiSolana(m.request,now),v=m.valuation,s=m.simulation;
 if(m.version!==1||m.sessionId!==state.sessionId||m.sourceFingerprint!==state.sourceFingerprint||r.from!==identity.source.solanaAddress||r.recipient!==r.from||r.deviceId!==identity.source.deviceId||r.chain!=='solana'||r.network!=='solana'||!/^[-a-zA-Z0-9_]{1,80}$/.test(m.routeId))throw Error('Wrong Solana acceptance scope, source or recipient.');
 if(state.operations.some(o=>o.fingerprint===r.fingerprint||!['settled','cancelled-before-signing'].includes(o.state))||state.permissions?.length)throw Error('Duplicate or unresolved operation or allowance.');
 if(m.requestFingerprint!==r.fingerprint||m.source!==r.from||m.destination!==r.recipient||m.chainId!==1151111081099710||m.genesisHash!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'||m.contractTarget!==validators.solanaLifiProgram||m.spender!==null||m.tokenContract!==(r.tokenIn==='USDC'?identity.usdc.solana:'native')||m.exactInput!==r.amount||m.minimumOutput!==r.minimumOutput||m.protocolFee!==r.protocolFee||m.maximumFee!==r.maximumFee||m.accountRent!==r.accountRent||m.slippageBps!==r.slippageBps||m.blockhash!==r.blockhash||m.lastValidBlockHeight!==r.lastValidBlockHeight||m.deadline!==r.expiresAt)throw Error('Solana public authorization differs from signed message.');
 if(!v||!Number.isSafeInteger(v.observedAt)||now-v.observedAt>120000||v.observedAt>now||!independent(v.sources)||uint(v.nativeUsdMicros)===0n||uint(v.assetUsdMicros)===0n||r.tokenIn==='SOL'&&v.nativeUsdMicros!==v.assetUsdMicros)throw Error('Fresh independent Solana valuation required.');
 if(!s||s.passed!==true||s.fingerprint!==r.fingerprint||!Number.isSafeInteger(s.observedAt)||now-s.observedAt>60000||s.observedAt>now||!independent(s.endpoints)||!Number.isSafeInteger(m.quoteObservedAt)||now-m.quoteObservedAt>60000||m.quoteObservedAt>now)throw Error('Fresh independent Solana simulations and quote required.');
 if(!Array.isArray(m.stopConditions)||!m.stopConditions.includes('uncertain-broadcast'))throw Error('Missing stop conditions.');
 const input=cost(r.amount,v.assetUsdMicros,r.tokenIn==='USDC'?6:9),fee=cost(r.maximumFee,v.nativeUsdMicros,9),rent=cost(r.accountRent,v.nativeUsdMicros,9),reserve=input+fee+rent,used=state.operations.filter(o=>o.state!=='cancelled-before-signing').reduce((n,o)=>n+uint(o.actualUsdMicros??o.reservedUsdMicros),0n),route=state.operations.filter(o=>o.routeId===m.routeId&&o.state!=='cancelled-before-signing').reduce((n,o)=>n+uint(o.actualUsdMicros??o.reservedUsdMicros),0n);
 // Bound all aggregator input as a possible embedded protocol fee as well.
 if(reserve>FEE_LIMIT||reserve+route>ROUTE_LIMIT||reserve+used>LIMIT)throw Error('Solana spending or fee ceiling exceeded.');
 if(uint(m.nativeReserve)<uint(r.maximumFee)+uint(r.accountRent)||uint(m.nativeBalance)<uint(r.maximumFee)+uint(r.accountRent)+(r.tokenIn==='SOL'?uint(r.amount):0n)+uint(m.nativeReserve))throw Error('Solana gas/rent reserve would be consumed.');
 return {fingerprint:r.fingerprint,routeId:m.routeId,sourceFingerprint:state.sourceFingerprint,reservedUsdMicros:reserve.toString(),manifestHash:digest(m),state:'reserved',reservedAt:new Date(now).toISOString()};
}
module.exports={cost,digest,authorizePayment,authorizeFunding,authorizeOperation,LIMIT,ROUTE_LIMIT,FEE_LIMIT};
