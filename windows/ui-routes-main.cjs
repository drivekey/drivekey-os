'use strict';
// Install only from the privileged main process. No secrets are accepted in imports.
const {preparedRecord}=require('./tools/request-lifecycle.cjs');
const fs=require('node:fs/promises');
const {TextDecoder}=require('node:util');
const {randomUUID}=require('node:crypto');
const paymentPolicy=require('./tools/store-payment-policy.cjs');
const {MAX_BYTES,parsePreparationText,privateSelection,bridgeSelection,preparePrivateDocument,prepareBridgeDocument,transactionDetail}=require('./preparation-import.cjs');
const {validateHinkalAcceptanceSeed,verifyHinkalProofAuthorization,verifyHinkalProofLink}=require('./dist/hinkal-proof-link.cjs');
const {HINKAL_PIN}=require('./dist/hinkal.cjs');
const reviewFns={
  29:require('./dist/hinkal-product-chain.cjs').productChainReview,
  8:require('./dist/payment.cjs').paymentReview,
  9:require('./dist/swap.cjs').swapReview,
  10:require('./dist/hinkal.cjs').hinkalReview,
  11:require('./dist/lifi-solana.cjs').lifiSolanaReview,
  12:require('./dist/lifi-evm.cjs').lifiEvmReview,
  14:require('./dist/hinkal-solana.cjs').hinkalSolanaReview,
  16:require('./dist/hinkal-solana-spend.cjs').hinkalSolanaSpendReview,
  18:require('./dist/hinkal-evm-swap.cjs').hinkalEvmSwapReview,
  21:require('./dist/hinkal-solana-swap.cjs').hinkalSolanaSwapReview
};
function historicalReview(request,bridgeCodec){
  const at=Date.parse(request?.createdAt);
  if(!Number.isSafeInteger(at)||at>Date.now()+60000)throw Error('Saved transaction timestamp is invalid.');
  const review=bridgeCodec(request)?.review||reviewFns[request?.version];
  if(typeof review!=='function')throw Error('Saved transaction version is unavailable.');
  // Reconstruct at creation time, so old valid records remain readable. This
  // never creates approval authority; actual signing still validates expiry.
  return [12,18,21,22,25,26,29].includes(request.version)?review(request,at,false):review(request,at);
}
async function readDocument(file){
  const handle=await fs.open(file,'r');let buffer;
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('Choose a preparation JSON file smaller than 256 KiB.');
    buffer=Buffer.alloc(MAX_BYTES+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>MAX_BYTES)throw Error('Preparation file exceeds the size limit.');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead));}catch{throw Error('Preparation file must be valid UTF-8 JSON.');}
    return parsePreparationText(text);
  }finally{buffer?.fill(0);await handle.close();}
}
function installRouteUi(c){
 const executionPolicy=c.policy??paymentPolicy;if(!executionPolicy||typeof executionPolicy.assertIntent!=='function'||typeof executionPolicy.allowedIntent!=='function')throw Error('A trusted route execution policy is required.');
  // c.getPublic must invoke requirePublic; c.getWindow returns current window.
  const scope=()=>{if(c.isOffline())throw Error('Preparation is unavailable in the offline companion.');return {wallet:structuredClone(c.getPublic()),window:c.getWindow()};};
  const assertScope=s=>{const current=c.getPublic();if(!s.window||s.window.isDestroyed?.()||c.getWindow()!==s.window||current.deviceId!==s.wallet.deviceId||current.evmAddress!==s.wallet.evmAddress||current.solanaAddress!==s.wallet.solanaAddress)throw Error('Preparation was canceled because the wallet or window changed.');};
  const deps=s=>({
    hinkalEvmContract:HINKAL_PIN.ethereumContract,
    validateSeed:seed=>validateHinkalAcceptanceSeed(seed),
    verifyAuthorization:(seed,auth,key)=>verifyHinkalProofAuthorization(seed,auth,key),
    verifyLink:(seed,auth,request,key)=>verifyHinkalProofLink(seed,auth,request,key),
    prepare:(action,input)=>{assertScope(s);return c.online({action,input,wallet:s.wallet});},
    validateRequest:request=>{c.validateIntent(request);c.assertIntentWallet(request,s.wallet);},
    reviewRequest:request=>c.reviewIntent(request)
  });
  async function importPreparation(selection,privateMode){
    if(privateMode)privateSelection(selection);else bridgeSelection(selection);
    const s=scope();c.clearPending();
    const picked=await c.dialog.showOpenDialog(s.window,{title:privateMode?'Import prepared private transaction':'Import prepared bridge plan',properties:['openFile'],filters:[{name:'DriveKey preparation JSON',extensions:['json']}]});
    assertScope(s);if(picked.canceled)return {cancelled:true};
    const document=await readDocument(picked.filePaths[0]);assertScope(s);
    const prepared=privateMode?await preparePrivateDocument(document,selection,s.wallet,deps(s)):await prepareBridgeDocument(document,selection,s.wallet,deps(s));
    assertScope(s);
    await c.transactionStore.put(preparedRecord(prepared.request));
    assertScope(s);
    const token=randomUUID();c.setPending({token,request:prepared.request,review:prepared.review,vaultHash:c.getVaultHash()});
    return {token,review:prepared.review};
  }
  c.register('import-prepared-private',selection=>importPreparation(selection,true));
  c.register('import-prepared-bridge',selection=>importPreparation(selection,false));
  c.register('invalidate-prepared-review',async()=>{c.clearPending();return {cleared:true};});
  c.register('review-saved-request',async input=>{
    if(!input||Object.keys(input).length!==1||!/^0x[0-9a-f]{64}$/.test(input.id))throw Error('Invalid transaction identity.');
    const s={wallet:structuredClone(c.getPublic()),window:c.getWindow()};c.clearPending();
    const record=await c.transactionStore.load(s.wallet.deviceId,input.id);assertScope(s);
    if(!record||record.state!=='prepared'||record.response)throw Error('Only an unsigned prepared request can be reviewed again.');
    const authorityRequest=structuredClone(record.request),freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(authorityRequest);if(await executionPolicy.assertIntent(authorityRequest)!==undefined)throw Error('Execution authority did not authorize the saved request.');assertScope(s);
    c.validateIntent(record.request);c.assertIntentWallet(record.request,s.wallet);
    if(c.verifyPreparedBinding)await c.verifyPreparedBinding(record,s.wallet,true);assertScope(s);
    const review=c.reviewIntent(record.request);assertScope(s);
    const token=randomUUID();c.setPending({token,request:record.request,review,...(record.productProof===undefined?{}:{productProof:record.productProof}),vaultHash:c.getVaultHash()});
    return {token,review};
  });
  c.register('copy-payment-request',async input=>{
    const wallet=structuredClone(c.getPublic()),qr=await c.makePaymentQR(wallet,input);
    const current=c.getPublic();if(current.deviceId!==wallet.deviceId||current.evmAddress!==wallet.evmAddress||current.solanaAddress!==wallet.solanaAddress)throw Error('Selected wallet changed.');
    try{await c.clipboard.writeText(qr.uri);if(await c.clipboard.readText()!==qr.uri)throw Error();}catch{throw Error('Clipboard unavailable. Use the displayed QR code or request.');}return {copied:true};
  });
  c.register('get-transaction',async input=>{
    if(!input||Object.keys(input).length!==1||!/^0x[0-9a-f]{64}$/.test(input.id))throw Error('Invalid transaction identity.');
    const wallet=structuredClone(c.getPublic()),record=await c.transactionStore.load(wallet.deviceId,input.id);
    if(!record)throw Error('Transaction is unavailable for the selected wallet.');
    if(record.response)await c.verifyIntent(record.response,record.request,wallet,Date.now(),false);
    if(c.verifyPreparedBinding)await c.verifyPreparedBinding(record,wallet,false);
    const review=historicalReview(record.request,c.bridgeCodec);
    if(c.getPublic().deviceId!==wallet.deviceId)throw Error('Selected wallet changed.');
    const signingState=c.getSigningState?await c.getSigningState(record,wallet):null;
    return {...transactionDetail(record,wallet,review),...(signingState?{state:signingState}:{}),paymentWritable:executionPolicy.allowedIntent(record.request),canDiscard:c.canDiscard?await c.canDiscard(record,wallet):false,handoffState:record.handoff?.state||'legacy-unknown'};
  });
}
module.exports={installRouteUi,historicalReview,readDocument};
