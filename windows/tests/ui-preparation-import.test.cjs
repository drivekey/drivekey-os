'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {MAX_BYTES,parsePreparationText,assertBoundedDocument,preparePrivateDocument,prepareBridgeDocument,transactionDetail}=require('../preparation-import.cjs');
const wallet={deviceId:'a8e25d4f-36d8-46cb-b129-728b8f354790',evmAddress:'0x1111111111111111111111111111111111111111',solanaAddress:'11111111111111111111111111111111'};
const copy=x=>structuredClone(x);
function setup(){
  const c={chain:'ethereum',action:'withdraw',asset:'USDC',amount:'100',from:wallet.evmAddress,recipient:'0x2222222222222222222222222222222222222222',inputNotes:['0xab']};
  const seed={version:13,deviceId:wallet.deviceId,fingerprint:'seed-fingerprint',expiresAt:'2026-11-03T00:10:00Z',maximumFee:'200',nonce:2,job:{context:c}};
  const authorization={fingerprint:seed.fingerprint,spendingPublicKey:['1','2']};
  const document={version:1,kind:'drivekey-preparation',route:'hinkal-evm',input:{seed,authorization,proof:{transaction:{to:'0x3333333333333333333333333333333333333333',value:'0',data:'0xab'},proofAuthorizationProvided:true,blockchainTransactionSigned:false,submitted:false}}};
  const request={version:10,deviceId:wallet.deviceId,chain:'ethereum',action:'hinkal-withdraw',from:wallet.evmAddress,recipient:c.recipient,amount:c.amount,fingerprint:'request-fingerprint'};
  const calls=[];
  const deps={hinkalEvmContract:document.input.proof.transaction.to,validateSeed:v=>{calls.push('seed');return v;},verifyAuthorization:(s,a)=>{calls.push('authorization');assert.equal(a.fingerprint,s.fingerprint);return a;},prepare:async(worker,input)=>{calls.push(['prepare',worker,input]);return request;},validateRequest:()=>{calls.push('validate');},verifyLink:()=>{calls.push('link');},reviewRequest:()=>{calls.push('review');return {amount:c.amount,fingerprint:request.fingerprint};}};
  return {document,request,deps,calls};
}
test('parser accepts a bounded preparation with quoted punctuation and rejects duplicate keys',()=>{
  const {document}=setup();document.input.proof.transaction.data='0xab';const text=JSON.stringify(document,null,2);assert.deepEqual(parsePreparationText(text),document);
  assert.throws(()=>parsePreparationText('{"version":1,"kind":"drivekey-preparation","route":"hinkal-evm","route":"hinkal-solana-spend","input":{}}'));
  assert.throws(()=>parsePreparationText('{"version":1,"kind":"drivekey-preparation","route":"hinkal-evm","input":{"amount":"1","\\u0061mount":"2"}}'));
  assert.throws(()=>parsePreparationText('{"version":1,"kind":"drivekey-preparation","route":"hinkal-evm","input":{"nested":[{"x":"a,b}\\\"","x":"2"}]}}'));
});
test('parser rejects oversized and excessive-depth documents',()=>{
  assert.throws(()=>parsePreparationText(' '.repeat(MAX_BYTES+1)));
  assert.throws(()=>parsePreparationText('{"version":1,"kind":"drivekey-preparation","route":"hinkal-evm","input":'+ '['.repeat(45)+'0'+']'.repeat(45)+'}'));
});
test('recursive screening rejects hidden key material, prototype fields and signed private transactions before preparation',async()=>{
  for(const [key,value]of [['nullifyingKey','0x123'],['PRIVATE_key','abc'],['passphrase','secret'],['view',{address:'x'}],['rawSignedTransaction','0xdead'],['__proto__',{unsafe:true}]]){
    const s=setup();Object.defineProperty(s.document.input.seed.job,key,{value,enumerable:true,writable:true});
    await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps));assert.deepEqual(s.calls,[]);
  }
});
test('private import rejects ambiguous selections and envelope metadata without executing adapters',async()=>{
  for(const change of [s=>s.document.extra=true,s=>s.document.route='other',s=>s.document.input.extra='value',s=>s.document.input.proof.extra='value']){
    const s=setup();change(s);await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps));assert.equal(s.calls.some(c=>Array.isArray(c)),false);
  }
  const s=setup();await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw',worker:'sign'},wallet,s.deps));assert.deepEqual(s.calls,[]);
});
test('selection chain, action, seed version and wallet are checked before network preparation',async()=>{
  for(const mutate of [s=>s.document.input.seed.deviceId='other',s=>s.document.input.seed.job.context.from='0x4444444444444444444444444444444444444444',s=>s.document.input.seed.job.context.action='deposit',s=>s.document.input.seed.version=19]){
    const s=setup();mutate(s);await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps));assert.equal(s.calls.some(c=>Array.isArray(c)),false);
  }
  const s=setup();await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'solana',action:'withdraw'},wallet,s.deps));assert.deepEqual(s.calls,[]);
});
test('authorization mismatch fails before network; failures never reflect attacker text',async()=>{
  const s=setup();s.deps.verifyAuthorization=()=>{throw Error('private-key-ATTACKER-CONTENT');};
  await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps),error=>!error.message.includes('ATTACKER'));
  assert.equal(s.calls.some(c=>Array.isArray(c)),false);
});
test('proof must be unsigned, unsubmitted, and target the pinned contract',async()=>{
  for(const mutate of [p=>p.submitted=true,p=>p.blockchainTransactionSigned=true,p=>p.proofAuthorizationProvided=false,p=>p.transaction.to='0x5555555555555555555555555555555555555555',p=>p.transaction.value='100']){
    const s=setup();mutate(s.document.input.proof);await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps));assert.equal(s.calls.some(c=>Array.isArray(c)),false);
  }
});
test('v10 input is derived from linked seed, not independently editable form terms',async()=>{
  const s=setup(),result=await preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps),prepared=s.calls.find(c=>Array.isArray(c));
  assert.equal(prepared[1],'hinkal-direct-prepare');assert.deepEqual(prepared[2],{action:'hinkal-withdraw',asset:'USDC',amount:'100',recipient:s.document.input.seed.job.context.recipient,data:'0xab',inputNotes:['0xab'],proofExpiresAt:s.document.input.seed.expiresAt,proofMaximumFee:'200',proofNonce:2});
  assert.deepEqual(s.calls.slice(-3),['validate','link','review']);assert.deepEqual(result,{request:s.request,review:{amount:'100',fingerprint:'request-fingerprint'}});
});
test('adapter substitution and final proof-link mismatch are rejected before review',async()=>{
  for(const mutate of [s=>s.request.version=18,s=>s.request.chain='solana',s=>s.request.from='0x4444444444444444444444444444444444444444',s=>s.request.action='hinkal-transfer',s=>s.deps.verifyLink=()=>{throw Error('mismatch');}]){
    const s=setup();mutate(s);await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'withdraw'},wallet,s.deps));assert.equal(s.calls.includes('review'),false);
  }
});
test('valid local-proof metadata is accepted, but invented proving artifacts are rejected',async()=>{
  const s=setup();s.document.route='hinkal-evm-swap';s.document.input.seed.version=19;s.document.input.seed.job.context.action='swap';s.document.input.proof={data:'0xab',proofAuthorizationProvided:true,blockchainTransactionSigned:false,submitted:false,localProof:true,provingArtifacts:['a'.repeat(64),'b'.repeat(64)]};s.request.version=18;s.request.action='hinkal-swap';
  await preparePrivateDocument(s.document,{chain:'ethereum',action:'swap'},wallet,s.deps);
  s.document.input.proof.provingArtifacts=['not-a-hash'];await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'ethereum',action:'swap'},wallet,s.deps));
});
test('Solana deposit plan must be view-only, source-owned and unsigned',async()=>{
  const s=setup(),input={provider:'hinkal',chain:'solana',action:'deposit',asset:'SOL',amount:'100',from:wallet.solanaAddress,recipient:wallet.solanaAddress,program:'program',originalDeployer:'deployer',merkleMIndex:'1',rootBucketCurrent:'root',rootBucketNext:'next',blockhash:'block',lastValidBlockHeight:1,unsignedTransaction:'unsigned',viewOnly:true,blockchainTransactionSigned:false,submitted:false};
  s.document.route='hinkal-solana-deposit';s.document.input=input;s.request={...s.request,version:14,chain:'solana',action:'hinkal-deposit',from:wallet.solanaAddress};s.deps.prepare=async()=>s.request;
  await preparePrivateDocument(s.document,{chain:'solana',action:'deposit'},wallet,s.deps);
  s.document.input.recipient='other';await assert.rejects(()=>preparePrivateDocument(s.document,{chain:'solana',action:'deposit'},wallet,s.deps));
});
test('bridge import only allows fixed source/redeem stages and selected wallet',async()=>{
  const s=setup();s.document.route='mayan-solana-source';s.document.input={requestId:'uuid',auxiliary:'public-key',amount:'1',quotedOutput:'1',minimumOutput:'1',redeemFee:'0',circleMaxFee:'0',destinationMaximumFee:'1',slippageBps:1};s.request={...s.request,version:23,chain:'solana',action:'bridge',from:wallet.solanaAddress};s.deps.prepare=async(worker)=>{assert.equal(worker,'mayan-solana-source-prepare');return s.request;};
  await prepareBridgeDocument(s.document,{route:'mayan-solana-source'},wallet,s.deps);
  await assert.rejects(()=>prepareBridgeDocument(s.document,{route:'mayan-evm-redeem'},wallet,s.deps));
  s.document.input.privateKey='secret';await assert.rejects(()=>prepareBridgeDocument(s.document,{route:'mayan-solana-source'},wallet,s.deps));
});
test('redemption accepts source signed bytes only in the narrowly scoped source response',async()=>{
  const s=setup();s.document.route='mayan-evm-redeem';s.document.input={sourceRequest:{version:23,chain:'solana',destinationChain:'ethereum',deviceId:wallet.deviceId,from:wallet.solanaAddress,recipient:wallet.evmAddress},sourceResponse:{rawSignedTransaction:'approved-source'},attestedMessage:'0x01',attestation:'0x02'};s.request={...s.request,version:24,action:'bridge-redeem'};s.deps.prepare=async()=>s.request;
  await prepareBridgeDocument(s.document,{route:'mayan-evm-redeem'},wallet,s.deps);
  s.document.input.attestation={rawSignedTransaction:'not-source'};await assert.rejects(()=>prepareBridgeDocument(s.document,{route:'mayan-evm-redeem'},wallet,s.deps));
});
test('detail returns no signed bytes, notes, proofs, receipt logs or unexpected nested data',()=>{
  const record={request:{version:22,deviceId:wallet.deviceId,chain:'ethereum',action:'bridge',from:wallet.evmAddress,recipient:wallet.solanaAddress,amount:'1',asset:'USDC',fingerprint:'0x'+'1'.repeat(64),createdAt:'2026-11-03T00:00:00Z'},response:{transactionHash:'0x123',rawSignedTransaction:'secret-signed'},state:'confirmed',settlement:{state:'confirmed',receipt:{logs:['sensitive']},sourceState:'confirmed'}};
  const futureTerm={hops:[{network:'ethereum',minimum:'100',maximum:200n}],cap:{amount:'300',units:'base units'}};
  const detail=transactionDetail(record,wallet,{amount:'1',futurePublicField:futureTerm,fingerprint:record.request.fingerprint});
  assert.equal(detail.state,'destination-pending');assert.equal(detail.sourceConfirmed,true);assert.equal(detail.destinationConfirmed,undefined);assert.equal(detail.canReconcileDestination,true);assert.equal(detail.receiptAvailable,false);assert.deepEqual(detail.review,{amount:'1',futurePublicField:{hops:[{network:'ethereum',minimum:'100',maximum:'200'}],cap:{amount:'300',units:'base units'}},fingerprint:record.request.fingerprint});assert.equal(JSON.stringify(detail).includes('secret'),false);
  for(const bad of [{rawSignedTransaction:'do-not-export'},{inputNotes:['note']},{proofSeed:{privateKey:'secret'}},{nested:{nullifyingKey:'secret'}}])assert.throws(()=>transactionDetail(record,wallet,bad),/private or raw/);
  record.destinationSettlement={state:'confirmed',completeRoute:true};assert.equal(transactionDetail(record,wallet,{}).destinationConfirmed,true);assert.equal(transactionDetail(record,wallet,{}).state,'confirmed');
  assert.throws(()=>transactionDetail(record,{...wallet,deviceId:'other'},{}));
});
test('actual cryptographic seed validator rejects altered imported proof context',()=>{
  const root=fs.existsSync(path.join(__dirname,'fixtures'))?path.resolve(__dirname,'..'):path.resolve(__dirname,'../../dependency-clean-candidate');
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/hinkal-solana-private-payment.json'),'utf8'));
  const seed=fixture.request.proofSeed,now=Date.parse(seed.createdAt)+1;
  const {validateHinkalAcceptanceSeed}=require(path.join(root,'dist/hinkal-proof-link.cjs'));
  assert.equal(validateHinkalAcceptanceSeed(seed,now).fingerprint,seed.fingerprint);
  const changed=copy(seed);changed.job.context.amount=(BigInt(changed.job.context.amount)+1n).toString();assert.throws(()=>validateHinkalAcceptanceSeed(changed,now));
});
