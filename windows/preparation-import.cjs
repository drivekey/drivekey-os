'use strict';
// Main-process only. Never return preparation documents to the renderer.
const MAX_BYTES=256*1024;
const PRIVATE_ROUTES=Object.freeze({
  'hinkal-evm':{chain:'ethereum',actions:['deposit','transfer','withdraw'],version:10,seed:[13],worker:'hinkal-direct-prepare'},
  'hinkal-solana-deposit':{chain:'solana',actions:['deposit'],version:14,worker:'hinkal-solana-prepare'},
  'hinkal-solana-spend':{chain:'solana',actions:['transfer','withdraw'],version:16,seed:[15],worker:'hinkal-solana-spend-prepare'},
  'hinkal-evm-swap':{chain:'ethereum',actions:['swap'],version:18,seed:[19],worker:'hinkal-evm-swap-prepare'},
  'hinkal-solana-swap':{chain:'solana',actions:['swap'],version:21,seed:[20,27],worker:'hinkal-solana-swap-prepare'}
});
const BRIDGE_ROUTES=Object.freeze({
  'mayan-solana-source':{chain:'solana',action:'bridge',version:23,worker:'mayan-solana-source-prepare'},
  'mayan-evm-redeem':{chain:'ethereum',action:'bridge-redeem',version:24,worker:'mayan-evm-redeem-prepare'}
});
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function fail(){throw Error('Prepared document is incompatible, contains private material, or differs from the selected route.');}
function shape(value,required,optional=[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
  if(required.some(k=>!own(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail();
  return value;
}
function assertBoundedDocument(value,{allowSourceResponse=false}={}){
  let count=0;
  function visit(v,depth,path){
    if(++count>35000||depth>40)fail();
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isSafeInteger(v))fail();return;}
    if(typeof v==='string'){if(v.length>MAX_BYTES)fail();return;}
    if(typeof v!=='object')fail();
    if(Array.isArray(v)){if(v.length>8192)fail();v.forEach((x,i)=>visit(x,depth+1,path.concat(String(i))));return;}
    if(Object.getPrototypeOf(v)!==Object.prototype)fail();
    for(const [key,item]of Object.entries(v)){
      const normalized=key.replace(/[^a-z]/gi,'').toLowerCase();
      if(['__proto__','prototype','constructor'].includes(key)||['view','secret','seedphrase','recoveryphrase','mnemonic','privatekey','secretkey','nullifyingkey','vault','password','passphrase','loginsignature','login','apikey','apitoken'].includes(normalized)||/privatekey|secretkey|passphrase|password|mnemonic|nullifyingkey|walletsecret/.test(normalized))fail();
      if(normalized==='rawsignedtransaction'&&!(allowSourceResponse&&path.join('.')==='input.sourceResponse'))fail();
      visit(item,depth+1,path.concat(key));
    }
  }
  visit(value,0,[]);
  let json;try{json=JSON.stringify(value);}catch{fail();}
  if(Buffer.byteLength(json,'utf8')>MAX_BYTES)fail();
  return value;
}
function parsePreparationText(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>MAX_BYTES)fail();
  let document;try{document=JSON.parse(text);}catch{fail();}
  // JSON.parse silently accepts duplicate keys. Reject ambiguous envelopes and
  // nested fields before a parsed document can select a route or identity.
  let offset=0,nodes=0;const space=()=>{while(/\s/.test(text[offset]||'')&&offset<text.length)offset++;};
  const string=()=>{const start=offset++;while(offset<text.length){const c=text[offset++];if(c==='\\')offset++;else if(c==='"')return JSON.parse(text.slice(start,offset));}fail();};
  function scan(depth){if(depth>40||++nodes>35000)fail();space();const char=text[offset];if(char==='{'){offset++;space();const keys=new Set();if(text[offset]==='}'){offset++;return;}for(;;){space();const key=string();if(keys.has(key))fail();keys.add(key);space();offset++;scan(depth+1);space();if(text[offset++]==='}')return;}}
    else if(char==='['){offset++;space();if(text[offset]===']'){offset++;return;}for(;;){scan(depth+1);space();if(text[offset++]===']')return;}}
    else if(char==='"')string();else{while(offset<text.length&&!/[\s,}\]]/.test(text[offset]))offset++;}}
  scan(0);space();if(offset!==text.length)fail();
  shape(document,['version','kind','route','input']);
  if(document.version!==1||document.kind!=='drivekey-preparation'||typeof document.route!=='string')fail();
  return document;
}
function privateSelection(selection){shape(selection,['chain','action']);if(!['ethereum','solana'].includes(selection.chain)||!['deposit','transfer','withdraw','swap'].includes(selection.action))fail();return selection;}
function bridgeSelection(selection){shape(selection,['route']);if(!own(BRIDGE_ROUTES,selection.route))fail();return selection;}
function identityEqual(a,b,chain){const evm=['ethereum','sepolia'].includes(chain),solana=['solana','devnet'].includes(chain);return typeof a==='string'&&typeof b==='string'&&(evm?/^0x[0-9a-f]{40}$/i.test(a)&&/^0x[0-9a-f]{40}$/i.test(b)&&a.toLowerCase()===b.toLowerCase():solana&&a===b);}
function sourceMatches(from,wallet,chain){const evm=['ethereum','sepolia'].includes(chain);if(!wallet||!identityEqual(from,evm?wallet.evmAddress:wallet.solanaAddress,chain))fail();}
function cleanError(operation){return Promise.resolve().then(operation).catch(()=>{throw Error('Prepared document could not be verified. Check the wallet, selected action, proof authorization and expiry.');});}
function proofShape(proof,route){
  if(route==='hinkal-evm'){
    shape(proof,['transaction','proofAuthorizationProvided','blockchainTransactionSigned','submitted']);
    shape(proof.transaction,['to','value','data']);
  }else if(route==='hinkal-evm-swap')shape(proof,['data','proofAuthorizationProvided','blockchainTransactionSigned','submitted'],['localProof','provingArtifacts']);
  else shape(proof,['solanaArgs','blockchainTransactionSigned','submitted'],route==='hinkal-solana-swap'?['localProof','proofAuthorizationProvided','provingArtifacts']:['proofAuthorizationProvided']);
  if(proof.blockchainTransactionSigned!==false||proof.submitted!==false||route==='hinkal-solana-swap'&&proof.localProof!==true||route.startsWith('hinkal-evm')&&proof.proofAuthorizationProvided!==true)fail();
  if(proof.proofAuthorizationProvided!==undefined&&proof.proofAuthorizationProvided!==true||proof.provingArtifacts!==undefined&&(!Array.isArray(proof.provingArtifacts)||proof.provingArtifacts.length!==2||proof.provingArtifacts.some(hash=>typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))))fail();
}
async function preparePrivateDocument(document,selection,wallet,deps){
  privateSelection(selection);shape(document,['version','kind','route','input']);
  if(document.version!==1||document.kind!=='drivekey-preparation'||!own(PRIVATE_ROUTES,document.route))fail();
  assertBoundedDocument(document);
  const route=PRIVATE_ROUTES[document.route];if(selection.chain!==route.chain||!route.actions.includes(selection.action))fail();
  let input,seed,authorization;
  if(document.route==='hinkal-solana-deposit'){
    input=shape(document.input,['provider','chain','action','asset','amount','from','recipient','program','originalDeployer','merkleMIndex','rootBucketCurrent','rootBucketNext','blockhash','lastValidBlockHeight','unsignedTransaction','viewOnly','blockchainTransactionSigned','submitted']);
    if(input.provider!=='hinkal'||input.chain!=='solana'||input.action!=='deposit'||!['SOL','USDC'].includes(input.asset)||input.viewOnly!==true||input.blockchainTransactionSigned!==false||input.submitted!==false||input.from!==input.recipient)fail();
    sourceMatches(input.from,wallet,'solana');
  }else{
    shape(document.input,['seed','authorization','proof']);
    seed=await cleanError(()=>deps.validateSeed(document.input.seed));
    if(!route.seed.includes(seed.version)||seed.deviceId!==wallet?.deviceId||seed.job.context.chain!==route.chain||seed.job.context.action!==selection.action)fail();
    sourceMatches(seed.job.context.from,wallet,route.chain);
    authorization=await cleanError(()=>deps.verifyAuthorization(seed,document.input.authorization,document.input.authorization?.spendingPublicKey));
    proofShape(document.input.proof,document.route);
    if(document.route==='hinkal-evm'){
      const c=seed.job.context,p=document.input.proof;
      if(!identityEqual(p.transaction.to,deps.hinkalEvmContract,'ethereum')||p.transaction.value!==(c.action==='deposit'&&c.asset==='ETH'?c.amount:'0'))fail();
      input={action:'hinkal-'+c.action,asset:c.asset,amount:c.amount,recipient:c.recipient,data:p.transaction.data,inputNotes:c.inputNotes,proofExpiresAt:seed.expiresAt,proofMaximumFee:seed.maximumFee,proofNonce:seed.nonce};
      if(c.action==='transfer')Object.assign(input,{recipientInfo:c.recipientInfo,recipientBindingSignature:c.recipientBindingSignature,recipientAcknowledgement:seed.recipientAcknowledgement,proofFingerprint:seed.fingerprint});
    }else input={seed,authorization,proof:document.input.proof};
  }
  const request=await cleanError(()=>deps.prepare(route.worker,input));
  if(request?.version!==route.version||request.deviceId!==wallet?.deviceId||request.chain!==selection.chain||request.action!=='hinkal-'+selection.action)fail();
  sourceMatches(request.from,wallet,selection.chain);
  await cleanError(()=>deps.validateRequest(request,wallet));
  if(seed)await cleanError(()=>deps.verifyLink(seed,authorization,request,authorization.spendingPublicKey));
  const review=await cleanError(()=>deps.reviewRequest(request));
  return {request,review};
}
async function prepareBridgeDocument(document,selection,wallet,deps){
  bridgeSelection(selection);shape(document,['version','kind','route','input']);
  if(document.version!==1||document.kind!=='drivekey-preparation'||document.route!==selection.route)fail();
  assertBoundedDocument(document,{allowSourceResponse:document.route==='mayan-evm-redeem'});
  const route=BRIDGE_ROUTES[document.route];
  if(document.route==='mayan-solana-source')shape(document.input,['requestId','auxiliary','amount','quotedOutput','minimumOutput','redeemFee','circleMaxFee','destinationMaximumFee','slippageBps']);
  else{
    shape(document.input,['sourceRequest','sourceResponse','attestedMessage','attestation']);
    const source=document.input.sourceRequest;
    if(source?.version!==23||source.deviceId!==wallet?.deviceId||source.chain!=='solana'||source.destinationChain!=='ethereum')fail();
    sourceMatches(source.from,wallet,'solana');if(!identityEqual(source.recipient,wallet?.evmAddress,'ethereum'))fail();
  }
  const request=await cleanError(()=>deps.prepare(route.worker,document.input));
  if(request?.version!==route.version||request.deviceId!==wallet?.deviceId||request.chain!==route.chain||request.action!==route.action)fail();
  sourceMatches(request.from,wallet,route.chain);
  await cleanError(()=>deps.validateRequest(request,wallet));
  return {request,review:await cleanError(()=>deps.reviewRequest(request))};
}
// Preserve every public validator term, including new structured terms. Reject
// the complete detail response if a validator ever returns secret/raw payloads.
function publicReview(value){
  let count=0;const seen=new Set(),blocked=new Set(['privatekey','secretkey','password','passphrase','mnemonic','nullifyingkey','vault','rawsignedtransaction','unsignedtransaction','proofseed','proofauthorization','inputnotes','encryptedoutputs','encryptedoutput','loginsignature']);
  function visit(v,depth){
    if(++count>5000||depth>16)throw Error('Transaction review exceeds its display limit.');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){if(v.length>20000)throw Error('Transaction review exceeds its display limit.');return v;}
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(typeof v==='bigint')return v.toString();
    if(!v||typeof v!=='object'||seen.has(v))throw Error('Transaction review contains unsupported data.');
    seen.add(v);let result;
    if(Array.isArray(v))result=v.map(x=>visit(x,depth+1));
    else{
      if(Object.getPrototypeOf(v)!==Object.prototype)throw Error('Transaction review contains unsupported data.');result={};
      for(const [key,item]of Object.entries(v)){
        if(key.length>120||['__proto__','constructor','prototype'].includes(key)||blocked.has(key.replace(/[^a-z]/gi,'').toLowerCase()))throw Error('Transaction review contains private or raw transaction data.');
        result[key]=visit(item,depth+1);
      }
    }
    seen.delete(v);return result;
  }
  const result=visit(value,0);if(!result||Array.isArray(result)||typeof result!=='object'||Buffer.byteLength(JSON.stringify(result),'utf8')>64*1024)throw Error('Transaction review exceeds its display limit.');return result;
}
function finalReceiptEvidence(record){
  if(!record||record.state!=='confirmed')throw Error('Only finalized transactions have receipts.');
  const destination=record.destinationSettlement;
  const evidence=destination?.completeRoute===true?destination:record.settlement||record.receipt;
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).length===0)throw Error('Finalized settlement evidence is unavailable.');
  if(evidence.state!==undefined&&evidence.state!=='confirmed')throw Error('Settlement evidence is not confirmed.');
  if(['bridge','bridge-redeem'].includes(record.request?.action)&&evidence.completeRoute!==true)throw Error('Complete bridge delivery is required before a final route receipt.');
  return evidence;
}
function receiptAvailable(record){try{finalReceiptEvidence(record);return true;}catch{return false;}}
function createFinalReceipt(record){
  const evidence=finalReceiptEvidence(record),receipt={version:1,walletId:record.request.deviceId,request:record.request,response:record.response,settlement:evidence,checkedAt:record.updatedAt};
  if(evidence===record.destinationSettlement&&record.settlement)receipt.sourceSettlement=record.settlement;
  // Detach the export payload without changing any journal or signed bytes.
  return JSON.parse(JSON.stringify(receipt));
}
// Explicit journal projection: saved signatures, requests and receipt logs never escape.
function transactionDetail(record,wallet,review){
  if(!record||record.request?.deviceId!==wallet?.deviceId)throw Error('Transaction is unavailable for the selected wallet.');
  const envelope=record.request,r=envelope.version===29?envelope.chainRequest:envelope;
  sourceMatches(r.from,wallet,r.chain);
  const result={id:envelope.fingerprint,version:envelope.version,action:r.action,provider:r.provider||'payment',network:r.chain,asset:r.asset||r.tokenIn,amount:r.amount,recipient:r.recipient,state:record.state,createdAt:r.createdAt,expiresAt:r.expiresAt,review:{},settlement:{},canReconcileDestination:r.version===22&&r.action==='bridge'&&!!record.response&&!['prepared','signed'].includes(record.state),receiptAvailable:receiptAvailable(record)};
  if(r.destinationChain)result.destinationNetwork=r.destinationChain;if(r.tokenOut)result.outputAsset=r.tokenOut;
  if(record.updatedAt)result.updatedAt=record.updatedAt;if(record.response?.transactionHash)result.transactionHash=record.response.transactionHash;if(record.response?.signedAt)result.signedAt=record.response.signedAt;
  if(typeof record.reason==='string')result.reason=record.reason.slice(0,400);
  const fullDestination=record.destinationSettlement?.state==='confirmed'&&record.destinationSettlement?.completeRoute===true||record.settlement?.state==='confirmed'&&record.settlement?.completeRoute===true;
  if(r.version===22&&r.action==='bridge'){
    if(fullDestination){result.sourceConfirmed=true;result.destinationConfirmed=true;result.state='confirmed';}
    else if(record.settlement?.state==='confirmed'||record.settlement?.sourceState==='confirmed'||record.state==='confirmed'){result.sourceConfirmed=true;result.state='destination-pending';}
  }else if([23,24,25,26].includes(r.version)){
    if(record.settlement?.sourceState==='confirmed'||fullDestination)result.sourceConfirmed=true;
    if(fullDestination)result.destinationConfirmed=true;
  }
  if(['bridge','bridge-redeem'].includes(r.action)&&record.state==='confirmed'&&!fullDestination){
    result.state='destination-pending';
    if(r.action==='bridge')result.sourceConfirmed=true;
  }
  result.review=publicReview(review);
  const sources=[record.destinationSettlement,record.settlement,record.receipt].filter(v=>v&&typeof v==='object');
  for(const key of ['blockNumber','blockHash','slot','actualFee','actualFeeBaseUnits','output','asset','recipient','completeRoute','sourceState','finalityVerified'])for(const source of sources){const v=source[key];if(typeof v==='string'&&v.length<=160||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)){result.settlement[key]=v;break;}}
  return result;
}
module.exports={MAX_BYTES,parsePreparationText,privateSelection,bridgeSelection,assertBoundedDocument,preparePrivateDocument,prepareBridgeDocument,transactionDetail,finalReceiptEvidence,receiptAvailable,createFinalReceipt};
