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
const {HinkalDirectAdapter} = localRequire('./dist/hinkal-direct.cjs');
const {
  HINKAL_ABI, assertHinkalWallet, hinkalApproval, hinkalReview, validateHinkal, verifyHinkalResponse,
} = localRequire('./dist/hinkal.cjs');
const {TransactionStore} = localRequire('./transaction-store.cjs');
const {SignatureStore} = localRequire('./signature-store.cjs');
const {RequestExchange} = localRequire('./tools/request-exchange.cjs');
const {installRouteUi} = localRequire('./ui-routes-main.cjs');

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

async function syntheticDeposit() {
  const signer = Wallet.createRandom();
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
  const rpcResults = {
    eth_getTransactionCount: '0x0', eth_gasPrice: '0x3b9aca00',
    eth_estimateGas: '0x61a8', eth_call: '0x',
  };
  class FixtureHinkalAdapter extends HinkalDirectAdapter {
    async identity() {}
  }
  const adapter = new FixtureHinkalAdapter({
    async rpc(chain, method) {
      assert.equal(chain, 'ethereum');
      assert.ok(Object.hasOwn(rpcResults, method), `Unexpected RPC method ${method}`);
      return rpcResults[method];
    },
    async balance() {return {native: '1000000000000000', amount: '1000000000000000'};},
  });
  const request = await adapter.prepare({
    action: 'hinkal-deposit', asset: 'ETH', amount, recipient: wallet.evmAddress, data, inputNotes: [],
  }, wallet);
  const rawSignedTransaction = await signer.signTransaction(Transaction.from(request.unsignedTransaction));
  const response = {
    version: 10, deviceId: wallet.deviceId, requestId: request.requestId,
    fingerprint: request.fingerprint, signedAt: new Date().toISOString(), rawSignedTransaction,
    transactionHash: Transaction.from(rawSignedTransaction).hash,
    approvalSignature: await signer.signMessage(hinkalApproval(request)),
  };
  assert.deepEqual(verifyHinkalResponse(response, request, wallet), response);
  return {wallet, request, response};
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-exchange-order-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const codec = {seal: value => Buffer.from(value), unseal: value => value.toString('utf8')};
  const journal = new TransactionStore(path.join(directory, 'journal'), codec);
  const signatures = new SignatureStore(path.join(directory, 'signatures'), codec);
  const {wallet, request, response} = await syntheticDeposit();
  const journalRecord = {version: 1, request, state: 'prepared'};
  await journal.put(journalRecord);
  assert.equal(JSON.stringify((await journal.load(wallet.deviceId, request.fingerprint)).request), JSON.stringify(request));
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
    register, transactionStore: journal, getPublic: () => wallet, getWindow: () => win,
    getVaultHash: () => null, clearPending: () => {pendingReview = undefined; exchange.clearBinding();},
    setPending: value => {pendingReview = value;}, validateIntent: validateHinkal,
    assertIntentWallet: assertHinkalWallet, reviewIntent: hinkalReview,
  });
  await handlers['review-saved-request']({id: request.fingerprint});
  installExchangeHandlers({
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
    assert.notEqual(JSON.stringify(exported), JSON.stringify(request));
    assert.equal(exported.fingerprint, request.fingerprint);
    fs.writeFileSync(responseFile, JSON.stringify(response), {flag: 'wx'});
    return exported;
  };
  return {
    exportRequest, importResponse, readJournal, readSignature, requestFile, responseFile,
    request, response, journalRecord, journalFile: journal.file(wallet.deviceId, request.fingerprint),
  };
}

test('native exchange accepts an exact signed deposit when journal key order differs', async t => {
  const f = await fixture(t);
  await f.exportRequest();
  assert.deepEqual(await f.importResponse(), {imported: true, transactionHash: f.response.transactionHash});
  const record = await f.readJournal();
  assert.equal(record.state, 'signed');
  assert.equal(JSON.stringify(record.request), JSON.stringify(f.request));
  assert.deepEqual(record.response, f.response);
  assert.deepEqual((await f.readSignature()).response, f.response);
  assert.deepEqual(await f.importResponse(), {imported: true, transactionHash: f.response.transactionHash});
});

test('native exchange still rejects altered journal terms before persisting a signature', async t => {
  const f = await fixture(t);
  await f.exportRequest();
  const request = {...f.request, amount: '10000000000001'};
  fs.writeFileSync(f.journalFile, JSON.stringify({...f.journalRecord, request}));
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
