'use strict';

// Executed only by Playwright's addInitScript in the renderer fixture harness.
// This file is not part of the application build or its packaged asset allowlist.
function installFixture(options) {
  const clone = value => value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const walletA = {id:'11111111-1111-4111-8111-111111111111',name:'Fixture daily wallet',deviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',evmAddress:'0x1111111111111111111111111111111111111111',solanaAddress:'11111111111111111111111111111111',backupVerified:false,watchOnly:false};
  const walletB = {id:'22222222-2222-4222-8222-222222222222',name:'Fixture reserve wallet',deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',evmAddress:'0x2222222222222222222222222222222222222222',solanaAddress:'So11111111111111111111111111111111111111112',backupVerified:false,watchOnly:false};
  const state = {
    offline:Boolean(options.offline), wallets:options.empty?[]:[walletA,walletB], activeId:null,
    calls:[], unexpected:[], queues:{}, counter:0, prepared:null, signatures:[], transactions:[], proofs:[],
    recoveryRequired:false,canRecover:false,error:null,qr:options.qr,refreshes:0
  };
  const current = () => state.wallets.find(w=>w.id===state.activeId);
  const requireCurrent = () => {const w=current();if(!w)throw Error('Select a software or watch-only wallet first.');return w;};
  const catalog = () => ({wallets:clone(state.wallets).map(w=>({...w,active:w.id===state.activeId})),activeId:state.activeId,recoveryRequired:state.recoveryRequired,canRecover:state.canRecover,error:state.error});
  const selected = () => {const w=requireCurrent();return {...catalog(),wallet:clone(w),public:{version:3,deviceId:w.deviceId,createdAt:'2026-01-01T00:00:00.000Z',evmAddress:w.evmAddress,solanaAddress:w.solanaAddress},watchOnly:w.watchOnly,backupVerified:w.backupVerified};};
  const id = () => '0x'+(++state.counter).toString(16).padStart(64,'0');
  function units(value,asset) {const d=asset==='USDC'?6:asset==='SOL'?9:18;const s=String(value).padStart(d+1,'0');return (s.slice(0,-d)+'.'+s.slice(-d)).replace(/\.?0+$/,'')||'0';}
  function reviewFor(input={},kind='payment') {
    const w=requireCurrent(),chain=input.chain||'sepolia',asset=input.asset||input.tokenIn||'ETH',fingerprint=id(),amount=input.amount||(asset==='USDC'?'1250000':asset==='SOL'?'250000000':'1000000000000000');
    const base = {action:kind,requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',deviceId:w.deviceId,network:['solana','devnet'].includes(chain)?'solana':'ethereum',chain,from:['solana','devnet'].includes(chain)?w.solanaAddress:w.evmAddress,recipient:input.recipient||'0x3333333333333333333333333333333333333333',asset,tokenContract:asset==='USDC'?'0x4444444444444444444444444444444444444444':'Native',amount:units(amount,asset)+' '+asset,baseUnits:amount,maximumFee:'0.000021 ETH',maximumFeeBaseUnits:'21000000000000',deadlineUTC:new Date(Date.now()+1200000).toISOString(),fingerprint,nonce:'0',warning:'SYNTHETIC UI FIXTURE — no signature or blockchain transaction exists.'};
    if(kind!=='payment') Object.assign(base,{minimumOutput:'3.45 USDC',quotedOutput:'3.50 USDC',slippageBps:'70',maximumSlippage:'0.7%',provider:'Fixture route',transactionTarget:'0x5555555555555555555555555555555555555555',unknownValidatorField:'This additional validator field must remain visible.'});
    if(kind==='bridge')Object.assign(base,{sourceNetwork:chain,destinationNetwork:chain==='ethereum'?'solana':'ethereum',destinationRecipient:input.destinationRecipient||input.recipient||w.solanaAddress,sourceSettlement:'Awaiting source transaction',destinationSettlement:'Not yet observed'});
    if(kind.startsWith('private'))Object.assign(base,{privacy:kind==='private-withdraw'?'Public withdrawal':'Supported shielded flow',proofVerification:'Verified fixture only — not a real proof'});
    state.prepared={token:'fixture-token-'+state.counter,review:base,requestCreatedAt:now()};
    state.transactions.unshift({id:fingerprint,network:base.network,chain,asset,amount:base.baseUnits,recipient:base.recipient,state:'prepared',createdAt:now(),updatedAt:now(),review:clone(base),action:kind});
    return clone(state.prepared);
  }
  const methods = {
    interfaceSettings:()=>({zoom:1}),
    setInterfaceZoom:zoom=>({zoom}),
    accountBalances:id=>{if(state.offline)throw Error('Networking disabled offline.');if(!state.wallets.some(w=>w.id===id))throw Error('Unknown account');return {accountId:id,balances:[{chain:'ethereum',asset:'ETH',amount:'1500000000000000000',stale:false},{chain:'ethereum',asset:'USDC',amount:'125000000',stale:false},{chain:'solana',asset:'SOL',amount:'2500000000',stale:false},{chain:'solana',asset:'USDC',amount:'125000000',stale:false}]};},
    marketSnapshot:currency=>({currency,source:'Synthetic UI fixture',fetchedAt:now(),stale:false,prices:[{id:'ethereum',symbol:'ETH',name:'Ethereum',price:2000,change24h:1,asOf:now(),walletSupported:true},{id:'solana',symbol:'SOL',name:'Solana',price:100,change24h:-1,asOf:now(),walletSupported:true},{id:'usd-coin',symbol:'USDC',name:'USD Coin',price:1,change24h:0,asOf:now(),walletSupported:true}]}),
    applicationMode:()=>({offline:state.offline,version:'UI-FIXTURE',fundingReady:false,capabilities:{privateProofCreation:options.productProofs===true,productProofAdmission:options.productAdmission===true}}),
    importProductProofPackage:()=>{if(!options.productAdmission)throw Error('Proof admission fixture unavailable.');const w=requireCurrent(),result=reviewFor({chain:'ethereum',asset:'ETH',amount:'100000000000000',recipient:w.evmAddress},'hinkal-swap');Object.assign(result.review,{action:'hinkal-swap',provider:'hinkal-lifi-1inch',minimumOutput:'200000',maximumFeeBaseUnits:'100000000000000',deadlineUTC:new Date(Date.now()+120000).toISOString()});return {...result,requiresSeparateChainReview:true,reused:false};},
    importProductProof:()=>{const w=requireCurrent();if(!options.productProofs||w.watchOnly)throw Error('Product proof fixture unavailable.');const result=reviewFor({chain:'ethereum',asset:'ETH',amount:'100000000000000',recipient:w.evmAddress},'private-proof-swap');Object.assign(result.review,{kind:'private-proof',action:'private-proof-swap',inputAsset:'ETH',outputAsset:'USDC',formattedInput:'0.0001 ETH',formattedMinimum:'0.20 USDC',authority:'Private-proof authorization only. Review the chain transaction separately.'});return result;},
    authorizeProductProof:(token,fingerprint,pass)=>{const w=requireCurrent();if(!w.backupVerified||w.watchOnly||pass!==options.passphrase||state.prepared?.token!==token||state.prepared?.review?.fingerprint!==fingerprint)throw Error('Product proof review or backup differs.');state.proofs.push({id:fingerprint,walletId:w.id,state:'authorized',localProvingSupported:true,chain:'ethereum',action:'private-proof-swap',amount:'100000000000000',asset:'ETH',createdAt:now()});state.prepared=null;return {kind:'private-proof',saved:false,recoverable:true,reviewConsumed:true,authorizationFingerprint:fingerprint,warning:'Synthetic UI fixture: no proof, chain transaction or broadcast was created. The real flow requires a separate chain review.'};},
    listProductProofs:()=>state.proofs.filter(r=>r.walletId===requireCurrent().id),
    exportProductProof:id=>{if(!state.proofs.some(r=>r.id===id&&r.walletId===requireCurrent().id))throw Error('Unknown proof fixture.');return {saved:true,kind:'private-proof',authorizationFingerprint:id};},
    reviewProductProof:()=>{throw Error('Queue an explicit proof review fixture.');},
    generateProductProof:(id,pass)=>{const w=requireCurrent(),record=state.proofs.find(r=>r.id===id&&r.walletId===w.id);if(!record||!w.backupVerified||pass!==options.passphrase)throw Error('Product proving fixture unavailable.');record.state='proved';return {proved:true,kind:'private-proof-result',requiresSeparateChainReview:true};},
    exportProductProofResult:id=>{if(!state.proofs.some(r=>r.id===id&&r.state==='proved'&&r.walletId===requireCurrent().id))throw Error('Unknown proof fixture.');return {saved:true,kind:'private-proof-result',requiresSeparateChainReview:true};},
    listWallets:()=>catalog(),
    createVault:(pass,confirm,name)=>{if(pass!==confirm)throw Error('The passphrases do not match.');if(pass.length<16||pass.length>256)throw Error('Passphrase must be 16–256 characters.');const w={...clone(walletA),id:'33333333-3333-4333-8333-333333333333',deviceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:name||'Fixture created wallet'};state.wallets.push(w);state.activeId=w.id;state.prepared=null;return selected();},
    loadVault:()=>{if(!state.wallets.length)state.wallets.push(clone(walletA));state.activeId=state.wallets[0].id;state.prepared=null;return selected();},
    importWatchWallet:()=>{if(state.offline)throw Error('The offline companion opens encrypted vaults. Import the public identity on the online computer.');const w={...clone(walletB),id:'44444444-4444-4444-8444-444444444444',name:'Fixture public wallet',watchOnly:true};state.wallets.push(w);state.activeId=w.id;state.prepared=null;return selected();},
    activateWallet:id=>{if(!state.wallets.some(w=>w.id===id))throw Error('Choose a wallet from your list.');state.activeId=id;state.prepared=null;return selected();},
    renameWallet:(id,name)=>{const w=state.wallets.find(w=>w.id===id);if(!w)throw Error('Wallet not found.');if(!name.trim()||name.length>40)throw Error('Use 1–40 visible characters for the wallet name.');w.name=name.trim();return catalog();},
    removeWallet:id=>{const cleared=state.activeId===id;state.wallets=state.wallets.filter(w=>w.id!==id);if(cleared){state.activeId=null;state.prepared=null;}return {...catalog(),cleared};},
    recoverWalletList:()=>{state.recoveryRequired=false;state.canRecover=false;state.error=null;state.wallets=[];state.activeId=null;return {...catalog(),recovered:true};},
    exportPublic:()=>{requireCurrent();return {saved:true};},
    exportBackup:()=>{const w=requireCurrent();if(w.watchOnly)throw Error('Create or open an encrypted vault first.');return {saved:true};},
    verifyBackup:pass=>{const w=requireCurrent();if(w.watchOnly)throw Error('Create or open an encrypted vault first.');if(pass!==options.passphrase)throw Error('Incorrect passphrase or damaged vault.');w.backupVerified=true;return {...catalog(),verified:true};},
    configureRPC:()=>{if(state.offline)throw Error('Offline companion has no networking.');state.prepared=null;return {configured:true};},
    paymentBalance:input=>{requireCurrent();if(state.offline)throw Error('Networking is disabled in the offline companion.');return {chain:input.chain,asset:input.asset,amount:input.asset==='USDC'?'125000000':input.asset==='SOL'?'2500000000':'1500000000000000000'};},
    receiveInfo:network=>{const w=requireCurrent();return {network,asset:network==='solana'?'SOL':'ETH',address:network==='solana'?w.solanaAddress:w.evmAddress,qr:state.qr};},
    copyAddress:network=>{requireCurrent();return {copied:true,network};},
    paymentQR:input=>{const w=requireCurrent();return {...input,qr:state.qr,uri:input.chain==='solana'||input.chain==='devnet'?'solana:'+w.solanaAddress+'?amount='+units(input.amount,input.asset):'ethereum:'+w.evmAddress+'@'+(input.chain==='sepolia'?'11155111':'1')+(input.asset==='USDC'?'/transfer?address='+w.evmAddress+'&uint256=':'?value=')+input.amount};},
    copyPaymentRequest:input=>{requireCurrent();return {copied:true,...input};},
    preparePayment:input=>reviewFor(input,'payment'),
    prepareSwap:input=>reviewFor(input,'swap'),
    prepareLifiEvm:input=>reviewFor(input,'swap'),
    prepareLifiSolana:input=>reviewFor(input,'swap'),
    prepareLifiMayanEvmSource:input=>reviewFor(input,'bridge'),
    prepareMayanSolanaSource:input=>reviewFor(input,'bridge'),
    prepareMayanEvmRedeem:input=>reviewFor(input,'bridge'),
    prepareLifiRelaySolana:input=>reviewFor(input,'bridge'),
    prepareLifiRelayEvm:input=>reviewFor(input,'bridge'),
    prepareHinkal:input=>reviewFor(input,'private-'+(input.action||'deposit')),
    prepareHinkalSolana:input=>reviewFor(input,'private-deposit'),
    prepareHinkalSolanaSpend:input=>reviewFor(input,'private-'+(input.action||'send')),
    prepareHinkalSolanaSwap:input=>reviewFor(input,'private-swap'),
    prepareHinkalEvmSwap:input=>reviewFor(input,'private-swap'),
    importPreparedPrivate:input=>reviewFor({chain:input.chain,asset:'USDC',amount:'1250000'},'private-'+input.action),
    importPreparedBridge:()=>reviewFor({chain:'ethereum',asset:'USDC',amount:'1250000'},'bridge'),
    invalidatePreparedReview:()=>{state.prepared=null;return {invalidated:true};},
    hinkalDiscover:input=>({provider:'hinkal',request:clone(input),result:{outSwapAmountValue:'3500000',fee:'0.02'},evidenceLevel:'synthetic-ui-fixture',executionEnabled:false}),
    exportPaymentRequest:()=>{if(!state.prepared)throw Error('Prepare an intent first.');return {saved:true};},
    chooseRequestExchange:()=>({folder:'Fixture exchange'}),
    clearRequestExchange:()=>({cleared:true}),
    importExchangeResponse:()=>methods.importPaymentResponse(),
    importPaymentResponse:()=>{const r=state.transactions.find(r=>r.state==='prepared');if(!r)throw Error('No matching prepared intent for this wallet.');r.state='signed';r.transactionHash='0x'+'a'.repeat(64);return {imported:true,transactionHash:r.transactionHash};},
    importRequest:()=>{const w=requireCurrent();if(w.watchOnly)throw Error('Create or open an encrypted vault first.');return reviewFor({chain:'sepolia',asset:'ETH',amount:'1000000000000000'},'payment');},
    sign:(token,fingerprint,pass)=>{const w=requireCurrent();if(w.watchOnly)throw Error('Create or open an encrypted vault first.');if(!w.backupVerified)throw Error('Verify a separate encrypted backup before signing.');if(!state.prepared||state.prepared.token!==token||state.prepared.review.fingerprint!==fingerprint)throw Error('Review expired or changed. Import the request again.');if(pass!==options.passphrase)throw Error('Incorrect passphrase or damaged vault.');const r=state.transactions.find(r=>r.id===fingerprint);r.state='signed';r.transactionHash='0x'+'b'.repeat(64);state.signatures.push({id:fingerprint.slice(2),requestId:r.review.requestId,network:r.network,signedAt:now(),transactionHash:r.transactionHash});state.prepared=null;return {saved:true,reviewConsumed:true,recoverable:true,transactionHash:r.transactionHash,warning:'Synthetic UI fixture: no signature or broadcast occurred.'};},
    listSignatures:()=>{const w=requireCurrent();if(w.watchOnly)throw Error('Create or open an encrypted vault first.');return clone(state.signatures);},
    recoverSigningResponse:(id,authority)=>{const row=state.signatures.find(s=>s.id===id&&s.state==='signing-uncertain'&&s.canRecoverOriginal);if(!row||authority!=='transaction')throw Error('Original committed response is unavailable in this fixture.');row.state='signed';row.canRecoverOriginal=false;delete row.warning;row.transactionHash='0x'+'c'.repeat(64);row.signedAt=now();return {restored:true,warning:'Original response recovered. No signature was created and no transaction was broadcast.'};},
    exportSignature:id=>{if(!state.signatures.find(s=>s.id===id))throw Error('Saved signature not found for this wallet.');return {saved:true,transactionHash:'0x'+'b'.repeat(64)};},
    listTransactions:()=>{requireCurrent();return clone(state.transactions);},
    getTransaction:id=>{requireCurrent();const r=state.transactions.find(r=>r.id===id);if(!r)throw Error('Transaction not found for this wallet.');return {...clone(r),summary:clone(r),review:clone(r.review),receiptAvailable:r.receiptAvailable??r.state==='confirmed',receipt:r.state==='confirmed'&&r.receiptAvailable!==false?{blockNumber:100,transactionHash:r.transactionHash,evidenceLevel:'synthetic-ui-fixture'}:null};},
    discardPreparedRequest:id=>{const row=state.transactions.find(r=>r.id===id);if(!row||row.state!=='prepared'||!row.canDiscard)throw Error('Draft cannot be discarded.');row.state='discarded';row.canDiscard=false;state.prepared=null;return {discarded:true,requiresFreshReview:true};},
    reviewSavedRequest:id=>{requireCurrent();const r=state.transactions.find(r=>r.id===id);if(!r||r.state!=='prepared')throw Error('No prepared request for this wallet.');if(Date.parse(r.expiresAt||r.review.deadlineUTC)<=Date.now())throw Error('Request expired. Prepare a new request.');state.prepared={token:'fixture-resumed-'+state.counter,review:clone(r.review)};return clone(state.prepared);},
    submitPayment:id=>{if(state.offline)throw Error('Offline companion cannot broadcast.');const r=state.transactions.find(r=>r.id===id);if(r?.state!=='signed')throw Error('Only a signed, never-submitted intent can be submitted. Reconcile prior submissions.');r.state='pending';return {submitted:true};},
    reconcilePayment:id=>{if(state.offline)throw Error('Networking is disabled in the offline companion.');const r=state.transactions.find(r=>r.id===id);if(!r)throw Error('Transaction not found.');state.refreshes++;r.state='pending';return {state:'pending',evidenceLevel:'synthetic-ui-fixture'};},
    reconcileLifiMayanDestination:id=>{const r=state.transactions.find(r=>r.id===id);if(!r)throw Error('Transaction not found.');return {state:'destination-pending',completeRoute:false};},
    exportPaymentReceipt:id=>{const r=state.transactions.find(r=>r.id===id);if(r?.state!=='confirmed')throw Error('Only finalized payments have receipts.');return {saved:true};},
    clear:()=>{state.activeId=null;state.prepared=null;state.wallets.forEach(w=>w.backupVerified=false);return {...catalog(),cleared:true};},
    openWeb:()=>{if(state.offline)throw Error('External links are disabled in the offline companion.');return {opened:true,hint:'Synthetic fixture: no browser opened.'};},
    listUpdates:()=>[{id:'workflow',title:'Synthetic workflow article',date:'3 Nov 2026'},{id:'hardware',title:'Synthetic hardware article',date:'2 Nov 2026'}]
  };
  const api = {};
  for(const [name,handler] of Object.entries(methods))api[name]=async(...args)=>{
    state.calls.push({method:name,args:args.map((v,i)=>(name==='generateProductProof'&&i===1)||['createVault','verifyBackup','sign','authorizeProductProof'].includes(name)&&(!['sign','authorizeProductProof'].includes(name)||i===2)?'[redacted fixture secret]':clone(v))});
    const scripted=state.queues[name]?.shift();
    try {
      if(scripted?.delay)await new Promise(r=>setTimeout(r,scripted.delay));
      if(scripted?.error)throw Error(scripted.error);
      if(scripted&&Object.hasOwn(scripted,'result'))return {ok:true,result:clone(scripted.result)};
      return {ok:true,result:await handler(...args)};
    }catch(error){return {ok:false,error:error.message};}
  };
  window.drivekey=Object.freeze(api);
  window.__fixture=Object.freeze({
    queue(name,...responses){if(!Object.hasOwn(methods,name))throw Error('Unknown fixture method: '+name);(state.queues[name]||=[]).push(...clone(responses));},
    snapshot:()=>clone(state),
    patch(values){for(const key of ['wallets','activeId','transactions','signatures','recoveryRequired','canRecover','error'])if(Object.hasOwn(values,key))state[key]=clone(values[key]);},
    seedTransaction(input={}){if(!current())state.activeId=state.wallets[0]?.id;const p=reviewFor(input,input.action||'payment');const r=state.transactions[0];Object.assign(r,clone(input));r.id=p.review.fingerprint;r.review={...p.review,...clone(input.review||{})};return clone(r);}
  });
  document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='SYNTHETIC UI FIXTURE · NO NETWORK OR SIGNING';b.dataset.fixtureBanner='true';b.style.cssText='position:fixed;right:8px;bottom:8px;z-index:99999;pointer-events:none;background:#102438;color:#cbe9ff;font:10px sans-serif;padding:4px 8px;border:1px solid #79d7ed;border-radius:4px';document.body.append(b);});
}
module.exports={installFixture};
