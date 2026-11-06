'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {createHash, randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');

const candidate = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(candidate, 'main.cjs'), 'utf8');
const localRequire = createRequire(path.join(candidate, 'main.cjs'));
const {Transaction, Wallet} = localRequire('ethers');
const {
  HINKAL_ABI, HINKAL_PIN, hinkalFingerprint, assertHinkalWallet, hinkalApproval, hinkalReview, validateHinkal, verifyHinkalResponse,
} = localRequire('./dist/hinkal.cjs');
const {TransactionStore} = localRequire('./transaction-store.cjs');
const {SignatureStore} = localRequire('./signature-store.cjs');
const {RequestExchange} = localRequire('./tools/request-exchange.cjs');
const {installRouteUi} = localRequire('./ui-routes-main.cjs');

const {createProfile,persist}=require('./helpers/unfunded-execution-profile.cjs');
const {exactFixturePolicy}=require('./helpers/unfunded-execution-policy.cjs');
const {createRecoveryStorage}=require('../tools/recovery-storage.cjs');
const {sourceFingerprint}=require('../BUILD-MANIFEST.json');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Exercise the exact main-process handlers with an in-process IPC registrar.
function installExchangeHandlers(fixture) {
  const start = main.indexOf('function exchangeScope() {');
  const end = main.indexOf("register('list-transactions'", start);
  assert.ok(start >= 0 && end > start);
  const bindings = {
    ...fixture,
    OFFLINE: false,
    encryptedVault: undefined,
    requirePublic: () => assert.ok(fixture.publicWallet),
    validateIntent: validateHinkal,
    assertIntentWallet: assertHinkalWallet,
    verifyIntent: verifyHinkalResponse,
    digest,
    isDeepStrictEqual,
  };
  new Function(...Object.keys(bindings), main.slice(start, end))(...Object.values(bindings));
}

async function syntheticDeposit(profile) {
  const signer = Wallet.createRandom();
  persist(profile,'fresh-key.dpapi',{privateKey:signer.privateKey});
  const wallet = {deviceId: randomUUID(), evmAddress: signer.address};
  const zero = '0x' + '0'.repeat(40);
  const amount = '10000000000000';
  // Only ABI shape and request binding are relevant. No valid zk proof is made.
  const data = HINKAL_ABI.encodeFunctionData('transact', [
    [1n, 2n], [[3n, 4n], [5n, 6n]], [7n, 8n], [1, 2, 1],
    [1, 0, [zero], [amount], [[0, 0]], [[1]], [['0x1234']], '0x', [false],
      [0], [zero, 0, 0], [0, 0, 0, 0, 0], 0, 0, 0, 1, zero,
      [wallet.evmAddress, 0, '0x'], [zero, zero, '0x', '0x'], wallet.evmAddress, '0x'],
  ]);
  // Assemble only a local ABI/exchange fixture. No provider/preflight or
  // key-bearing product signer is invoked; this fake proof cannot qualify one.
  const now=Date.now(),request={version:10,provider:'hinkal',action:'hinkal-deposit',network:'ethereum',chain:'ethereum',requestId:randomUUID(),deviceId:wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),from:wallet.evmAddress,recipient:wallet.evmAddress,asset:'ETH',amount,maximumFee:'60000000000000',contractCodeHash:HINKAL_PIN.ethereumCodeHash,inputNotes:[],unsignedTransaction:Transaction.from({type:2,chainId:1,nonce:0,to:HINKAL_PIN.ethereumContract,value:amount,data,gasLimit:30000n,maxFeePerGas:2000000000n,maxPriorityFeePerGas:1000000000n}).unsignedSerialized,fingerprint:''};
  request.fingerprint=hinkalFingerprint(request);validateHinkal(request,now);
  const rawSignedTransaction = await signer.signTransaction(Transaction.from(request.unsignedTransaction));
  const response = {
    version: 10, deviceId: wallet.deviceId, requestId: request.requestId,
    fingerprint: request.fingerprint, signedAt: new Date().toISOString(), rawSignedTransaction,
    transactionHash: Transaction.from(rawSignedTransaction).hash,
    approvalSignature: await signer.signMessage(hinkalApproval(request)),
  };
  assert.deepEqual(verifyHinkalResponse(response, request, wallet), response);
  persist(profile,'signed-fixture.dpapi',{wallet,request,response});
  return {wallet, request, response};
}

async function fixture(t) {
  const profile=createProfile(),directory=profile.directory;
  const storage=createRecoveryStorage(directory,{});await storage.ready();
  const codec=storage.forJournal('transactions');
  const journal = new TransactionStore(path.join(directory, 'transactions'), codec);
  const signatures = new SignatureStore(path.join(directory, 'signatures'), storage.forJournal('signatures'));
  const {wallet, request, response} = await syntheticDeposit(profile);
  // Persist deliberately different property order, while keeping every term exact.
  const journalRecord = {version: 1, request:Object.fromEntries(Object.entries(request).reverse()), state: 'prepared'};
  await journal.put(journalRecord);
  assert.deepEqual(journalRecord.request,request);
  assert.notEqual(JSON.stringify(journalRecord.request),JSON.stringify(request));
  assert.equal(JSON.stringify((await journal.load(wallet.deviceId, request.fingerprint)).request), JSON.stringify(journalRecord.request));
  const exchange = new RequestExchange();
  const selectedDirectory = path.join(directory, 'exchange');
  fs.mkdirSync(selectedDirectory);
  const win = {id: 1, isDestroyed: () => false};
  const activeWalletId = randomUUID();
  exchange.choose(selectedDirectory, JSON.stringify([win.id, activeWalletId, wallet]));
  const handlers = {};
  const register = (channel, handler) => {handlers[channel] = handler;};
  let pendingReview;
  installRouteUi({
    policy:exactFixturePolicy(request,wallet,{sourceFingerprint}),
    register, transactionStore: journal, getPublic: () => wallet, getWindow: () => win,
    getVaultHash: () => null, clearPending: () => {pendingReview = undefined; exchange.clearBinding();},
    setPending: value => {pendingReview = value;}, validateIntent: validateHinkal,
    assertIntentWallet: assertHinkalWallet, reviewIntent: hinkalReview,
  });
  await handlers['review-saved-request']({id: request.fingerprint});
  const attempts=new (require('../tools/signing-attempts.cjs').SigningAttempts)(directory,storage,{'transaction':signatures});
  const requestLifecycleUi=require('../tools/request-lifecycle.cjs').installRequestLifecycle({register,store:journal,attempts,getPublic:()=>wallet,getWindow:()=>win,clearPending(){},review:hinkalReview});
  installExchangeHandlers({
    paymentPolicy:exactFixturePolicy(request,wallet,{sourceFingerprint}),requestLifecycleUi,
    register, win, activeWalletId, pendingReview, publicWallet: wallet,
    transactionStore: journal, signatureStore: signatures, requestExchange: exchange,
  });
  const requestDirectory = path.join(selectedDirectory, request.requestId);
  const requestFile = path.join(requestDirectory, 'request.json');
  const responseFile = path.join(requestDirectory, 'signed-response.json');
  const importResponse = () => handlers['import-exchange-response']();
  const readJournal = () => journal.load(wallet.deviceId, request.fingerprint);
  const readSignature = () => signatures.load(wallet.deviceId, request.fingerprint.slice(2));
  const exportRequest = async () => {
    const result = await handlers['export-payment-request']();
    assert.equal(result.requestDirectory, request.requestId);
    const exported = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    assert.deepEqual(exported, request);
    assert.notEqual(JSON.stringify(exported), JSON.stringify(journalRecord.request));
    assert.equal(exported.fingerprint, request.fingerprint);
    fs.writeFileSync(responseFile, JSON.stringify(response), {flag: 'wx'});
    return exported;
  };
  return {
    exportRequest, importResponse, readJournal, readSignature, requestFile, responseFile,
    request, response, journalRecord,writeJournal:async record=>fs.promises.writeFile(journal.file(wallet.deviceId,request.fingerprint),await codec.seal(JSON.stringify(record))), journalFile: journal.file(wallet.deviceId, request.fingerprint),
  };
}

test('native exchange accepts an exact signed deposit when journal key order differs', async t => {
  const f = await fixture(t);
  await f.exportRequest();
  assert.deepEqual(await f.importResponse(), {imported: true, transactionHash: f.response.transactionHash});
  const record = await f.readJournal();
  assert.equal(record.state, 'signed');
  assert.equal(JSON.stringify(record.request), JSON.stringify(f.journalRecord.request));
  assert.deepEqual(record.response, f.response);
  assert.deepEqual((await f.readSignature()).response, f.response);
  assert.deepEqual(await f.importResponse(), {imported: true, transactionHash: f.response.transactionHash});
});

test('native exchange still rejects altered journal terms before persisting a signature', async t => {
  const f = await fixture(t);
  await f.exportRequest();
  const request = {...f.request, amount: '10000000000001'};
  await f.writeJournal({...f.journalRecord, request});
  await assert.rejects(f.importResponse(), /^Error: Response differs from the current reviewed request\.$/);
  assert.equal((await f.readJournal()).state, 'prepared');
  assert.equal(await f.readSignature(), null);
});

test('native exchange still rejects a modified export or invalid signed response', async t => {
  const f = await fixture(t);
  const exported = await f.exportRequest();
  fs.writeFileSync(f.requestFile, JSON.stringify({...exported, amount: '10000000000001'}));
  await assert.rejects(f.importResponse(), /Exported request was changed/);
  fs.writeFileSync(f.requestFile, JSON.stringify(exported));
  fs.writeFileSync(f.responseFile, JSON.stringify({...f.response, transactionHash: '0x' + '0'.repeat(64)}));
  await assert.rejects(f.importResponse(), /Hinkal signature differs from reviewed intent/);
  assert.equal((await f.readJournal()).state, 'prepared');
  assert.equal(await f.readSignature(), null);
});
