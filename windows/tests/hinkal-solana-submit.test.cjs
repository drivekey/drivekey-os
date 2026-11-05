'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {gunzipSync} = require('node:zlib');
const {Keypair, PublicKey, TransactionMessage, VersionedMessage, VersionedTransaction} = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const {Transaction, Wallet} = require('ethers');
const {TransactionStore} = require('../transaction-store.cjs');
const {SignatureStore} = require('../signature-store.cjs');
const {SigningAttempts} = require('../tools/signing-attempts.cjs');
const {OnlineAdapter} = require('../dist/adapter.cjs');
const {HinkalSolanaAdapter} = require('../dist/hinkal-solana-adapter.cjs');
const {
  HINKAL_SOLANA, hinkalSolanaFingerprint, hinkalSolanaApproval, validateHinkalSolana, verifyHinkalSolanaResponse, hinkalSolanaReview,
} = require('../dist/hinkal-solana.cjs');
const {CHAINS, paymentFingerprint, paymentApproval, validatePayment, verifyPaymentResponse, paymentReview} = require('../dist/payment.cjs');
const plan = require('./fixtures/hinkal-solana-deposit.json').result;
const idl = require('../vendor/hinkal/solana-idl.json');
const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const pins = [HINKAL_SOLANA.pin, ...require('../vendor/jupiter/program-pins.json').programs.filter(pin => /^(ATokenGP|Tokenkeg)/.test(pin.address))];
const programBytes = gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/hinkal-solana-pinned-programs.bin.gz')),
  {maxOutputLength: pins.reduce((size, pin) => size + pin.space, 0)});
let offset = 0;
const programs = pins.map(pin => {
  const end = offset + pin.space;
  const bytes = programBytes.subarray(offset, end);
  offset = end;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.programDataSha256);
  const pointer = pin.address === pin.programData ? bytes.subarray(0, 45) : Buffer.alloc(36);
  if (pin.address !== pin.programData) {
    pointer.writeUInt32LE(2);
    new PublicKey(pin.programData).toBuffer().copy(pointer, 4);
  }
  return {pin, bytes, pointer};
});
assert.equal(offset, programBytes.length);
let nextFixturePort = 8899;

function solanaRequest({expired = false, badSignature = false} = {}) {
  const key = Keypair.generate();
  const secret = key.secretKey;
  try {
    const now = Date.now(), created = expired ? now - 300000 : now;
    const original = VersionedTransaction.deserialize(Buffer.from(plan.unsignedTransaction, 'base64'));
    const message = TransactionMessage.decompile(original.message);
    message.payerKey = key.publicKey;
    message.instructions[0].keys[0].pubkey = key.publicKey;
    const tx = new VersionedTransaction(message.compileToLegacyMessage());
    const from = key.publicKey.toBase58();
    const wallet = {deviceId: randomUUID(), solanaAddress: from};
    const request = {version: 14, provider: 'hinkal', action: 'hinkal-deposit', network: 'solana', chain: 'solana',
      requestId: randomUUID(), deviceId: wallet.deviceId, createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + 180000).toISOString(), from, recipient: from, asset: plan.asset, amount: plan.amount,
      maximumFee: '5000', accountRent: '0', blockhash: plan.blockhash, lastValidBlockHeight: 1000,
      merkleMIndex: plan.merkleMIndex, programDataSha256: HINKAL_SOLANA.pin.programDataSha256,
      unsignedTransaction: Buffer.from(tx.serialize()).toString('base64')};
    request.fingerprint = hinkalSolanaFingerprint(request);
    tx.sign([{publicKey: key.publicKey, secretKey: secret}]);
    const response = {version: 14, deviceId: wallet.deviceId, requestId: request.requestId, fingerprint: request.fingerprint,
      signedAt: new Date(created + 1).toISOString(), rawSignedTransaction: Buffer.from(tx.serialize()).toString('base64'),
      transactionHash: bs58.encode(tx.signatures[0]), approvalSignature: bs58.encode(nacl.sign.detached(hinkalSolanaApproval(request), secret))};
    verifyHinkalSolanaResponse(response, request, wallet, Date.now(), false);
    if (badSignature) response.approvalSignature = bs58.encode(Buffer.alloc(64, 1));
    return {wallet, request, response};
  } finally {secret.fill(0);}
}

async function paymentRequest() {
  const key = Wallet.createRandom(), now = Date.now();
  const wallet = {deviceId: randomUUID(), evmAddress: key.address};
  const recipient = '0x' + '1'.repeat(40);
  const request = {version: 8, action: 'payment', chain: 'ethereum', network: 'ethereum', requestId: randomUUID(),
    deviceId: wallet.deviceId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 180000).toISOString(),
    from: key.address, recipient, asset: 'ETH', amount: '1', maximumFee: '21000', accountRent: '0',
    createRecipientAccount: false, blockhash: null, lastValidBlockHeight: null,
    unsignedTransaction: Transaction.from({type: 2, chainId: 1, nonce: 0, to: recipient, value: 1n,
      gasLimit: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n}).unsignedSerialized};
  request.fingerprint = paymentFingerprint(request);
  const raw = await key.signTransaction(Transaction.from(request.unsignedTransaction));
  const response = {version: 8, deviceId: wallet.deviceId, requestId: request.requestId, fingerprint: request.fingerprint,
    signedAt: new Date(now).toISOString(), rawSignedTransaction: raw, transactionHash: Transaction.from(raw).hash,
    approvalSignature: await key.signMessage(paymentApproval(request))};
  return {wallet, request, response};
}

function rpcFixture(request, response, control, checkSend = async () => {}) {
  const merkle = Buffer.alloc(6489);
  Buffer.from(idl.accounts.find(item => item.name === 'Merkle').discriminator).copy(merkle);
  Buffer.from(BigInt(request.merkleMIndex).toString(16).padStart(64, '0'), 'hex').copy(merkle, 6409);
  const blockhash = () => control.hashSelected ? control.freshHash : request.blockhash;
  const transport = async (_endpoint, init) => {
    const {id, method, params} = JSON.parse(init.body);
    control.rpc.push(method);
    let result;
    switch (method) {
      case 'getGenesisHash': result = CHAINS.solana.genesis; break;
      case 'getLatestBlockhash':
        assert.ok(control.freshHash && !control.hashSelected);
        assert.deepEqual(params, [{commitment: 'confirmed'}]);
        control.hashSelected = true;
        result = {value: {blockhash: control.freshHash, lastValidBlockHeight: 1200}};
        break;
      case 'isBlockhashValid':
        assert.deepEqual(params, [blockhash(), {commitment: 'confirmed'}]);
        result = {value: control.blockhashValid}; break;
      case 'getBlockHeight': result = 850; break;
      case 'getEpochInfo': result = {absoluteSlot: 465332147, blockHeight: 850}; break;
      case 'getBlock':
        assert.equal(params[0], 465332147);
        assert.equal(params[1].commitment, 'confirmed');
        result = {blockHeight: control.heightMismatch ? 851 : 850, blockhash: blockhash()};
        break;
      case 'getMultipleAccounts':
        if (params[1].dataSlice.length === 0) result = {value: params[0].map((_, index) => ({
          owner: index === 1 ? '11111111111111111111111111111111' : HINKAL_SOLANA.program, space: 0, lamports: 0,
        }))};
        else result = {value: params[0].map(address => {
          const program = programs.find(row => row.pin.address === address);
          if (!program) return null;
          if (address === HINKAL_SOLANA.program && Object.hasOwn(control, 'programIdentity')) return control.programIdentity;
          return {executable: true, owner: program.pin.loader, data: [program.pointer.toString('base64'), 'base64']};
        })};
        break;
      case 'getAccountInfo': {
        const program = programs.find(row => row.pin.programData === params[0]);
        if (!program) {
          const bytes = Buffer.from(merkle);
          if (control.hashSelected && control.cursorMoved) Buffer.from((BigInt(request.merkleMIndex) + HINKAL_SOLANA.rootBucketCap).toString(16).padStart(64, '0'), 'hex').copy(bytes, 6409);
          result = {value: {data: [bytes.toString('base64'), 'base64']}};
          break;
        }
        const slice = params[1].dataSlice;
        const bytes = Buffer.from(program.bytes.subarray(slice.offset, slice.offset + slice.length));
        if (control.badProgramBytes && program.pin.address === HINKAL_SOLANA.program && slice.length > 45) bytes[45] ^= 1;
        if (control.hashSelected && control.deploymentChanged && program.pin.address === HINKAL_SOLANA.program && slice.offset === 0) bytes.writeBigUInt64LE(BigInt(program.pin.deployedSlot) + 1n, 4);
        control.programSlices.push({address: params[0], afterFinalHash: Boolean(control.hashSelected), ...slice});
        result = {context: {slot: control.hashSelected ? 465332147 : 465332146}, value: {owner: program.pin.loader, space: program.pin.space,
          data: [bytes.toString('base64'), 'base64']}};
        break;
      }
      case 'getMinimumBalanceForRentExemption': result = control.hashSelected && control.rentIncreased ? 1 : 0; break;
      case 'getBalance': result = {value: control.hashSelected && control.balanceDropped ? 0 : 10000000}; break;
      case 'getFeeForMessage': {
        const message = VersionedMessage.deserialize(Buffer.from(params[0], 'base64'));
        assert.equal(message.recentBlockhash, blockhash());
        assert.deepEqual(params[1], {commitment: 'confirmed'});
        control.feeReads = (control.feeReads || 0) + 1;
        result = {value: control.feeIncreased && control.feeReads === 2 ? 5001 : 5000};
        break;
      }
      case 'simulateTransaction': {
        const expected = VersionedTransaction.deserialize(Buffer.from(request.unsignedTransaction, 'base64'));
        expected.message.recentBlockhash = blockhash();
        assert.deepEqual(params, [Buffer.from(expected.serialize()).toString('base64'), {encoding: 'base64', sigVerify: false,
          replaceRecentBlockhash: false, commitment: 'confirmed'}]);
        result = {value: {err: control.simulationError}};
        break;
      }
      case 'sendTransaction':
        assert.deepEqual(params, [response.rawSignedTransaction, {encoding: 'base64', skipPreflight: false,
          preflightCommitment: 'confirmed', maxRetries: 0}]);
        await checkSend();
        result = control.wrongAcknowledgement ? 'wrong-signature' : response.transactionHash;
        break;
      default: throw Error('Unexpected synthetic RPC ' + method);
    }
    return {jsonrpc: '2.0', id, result};
  };
  return new HinkalSolanaAdapter(new OnlineAdapter({solana: 'http://localhost:' + nextFixturePort++}, transport));
}

function installSubmit(bindings) {
  // The extracted native handler uses the same policy dependency as the app.
  bindings.paymentPolicy = require("../tools/store-payment-policy.cjs");
  const begin = main.indexOf("register('submit-payment',");
  const end = main.indexOf("register('reconcile-payment',", begin);
  assert.ok(begin >= 0 && end > begin);
  const scopeBegin=main.indexOf('function importScope()'),scopeEnd=main.indexOf("register('choose-request-exchange'",scopeBegin);assert.ok(scopeBegin>=0&&scopeEnd>scopeBegin);
  new Function(...Object.keys(bindings),main.slice(scopeBegin,scopeEnd)+main.slice(begin,end))(...Object.values(bindings));
}

async function mainFixture(t, options = {}) {
  const {wallet, request, response} = options.ethereum ? await paymentRequest() : solanaRequest(options);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-v14-submit-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const codec = {seal: text => Buffer.from(text), unseal: bytes => bytes.toString('utf8')};
  const store = new TransactionStore(directory, codec);
  const read = () => store.load(wallet.deviceId, request.fingerprint);
  await store.put({version: 1, request, response, state: options.initialState || 'signed'});
  const control = {confirmation: 1, blockhashValid: true, simulationError: null, rpc: [], programSlices: [], journal: [], jobs: [], dialogs: []};
  const adapter = options.ethereum ? null : rpcFixture(request, response, control, async () => {
    const persisted = await new TransactionStore(directory, codec).load(wallet.deviceId, request.fingerprint);
    assert.equal(persisted.state, 'submitting');
    assert.deepEqual(persisted.response, response);
  });
  let submit;
  const window = {isDestroyed:()=>false};
  const signatures=new SignatureStore(path.join(directory,'signature-fixture'),codec),signingAttempts=new SigningAttempts(path.join(directory,'recovery-fixture'),{forJournal:()=>codec},{'transaction':signatures});
  installSubmit({
    register(channel, handler) {assert.equal(channel, 'submit-payment'); submit = handler;},
    requirePublic() {}, OFFLINE: false, publicWallet: wallet, win: window,activeWalletId:wallet.deviceId,signingAttempts,require,
    transactionStore: {load: store.load.bind(store), async put(record) {
      control.journal.push(record.state);
      if (control.failJournal) throw Error('Synthetic journal failure');
      return store.put(record);
    }},
    validateIntent: options.ethereum ? validatePayment : validateHinkalSolana,
    verifyIntent: options.ethereum ? verifyPaymentResponse : verifyHinkalSolanaResponse,
    reviewIntent: options.ethereum ? paymentReview : hinkalSolanaReview,
    dialog: {async showMessageBox(owner, terms) {
      assert.equal(owner, window);
      control.dialogs.push(terms);
      return {response: control.confirmation};
    }},
    intentAction: (value, action) => value.version === 14 ? 'hinkal-solana-' + action : action,
    async online(job) {
      control.jobs.push(job.action);
      assert.deepEqual(job.request, request);
      const saved = await read();
      if (job.action.endsWith('preflight')) {
        assert.equal(saved.state, 'signed');
        return adapter?.preflight(job.request);
      }
      assert.equal(saved.state, 'submitting');
      assert.deepEqual(job.response, response);
      return adapter?.broadcast(job.request, job.response);
    },
  });
  return {control, read, wallet, request, response, adapter, submit: () => submit({id: request.fingerprint})};
}

test('V14 native cancel does not start a worker or write a journal transition', async t => {
  const f = await mainFixture(t);
  f.control.confirmation = 0;
  assert.deepEqual(await f.submit(), {cancelled: true});
  const [dialog] = f.control.dialogs;
  assert.deepEqual(dialog.buttons, ['Cancel', 'Broadcast exact transaction']);
  assert.equal(dialog.defaultId, 0);
  assert.equal(dialog.cancelId, 0);
  assert.match(dialog.detail, new RegExp(f.request.fingerprint));
  assert.equal((await f.read()).state, 'signed');
  assert.deepEqual([f.control.jobs, f.control.journal, f.control.rpc], [[], [], []]);
});

test('V14 native consent persists submitting before one exact broadcast worker and its full preflight', async t => {
  const f = await mainFixture(t);
  assert.deepEqual(await f.submit(), {submitted: true});
  assert.deepEqual(f.control.jobs, ['hinkal-solana-broadcast']);
  assert.deepEqual(f.control.journal, ['submitting', 'pending']);
  assert.equal((await f.read()).state, 'pending');
  assert.deepEqual(f.control.rpc, ['getGenesisHash', 'isBlockhashValid', 'getEpochInfo', 'getBlock', 'getMultipleAccounts',
    'getAccountInfo', 'getMinimumBalanceForRentExemption', 'getMultipleAccounts',
    ...Array(11).fill('getAccountInfo'),
    'getGenesisHash', 'getBalance', 'getFeeForMessage', 'simulateTransaction', 'sendTransaction']);
  for (const {pin} of programs) {
    const fullReads = f.control.programSlices.filter(row => row.address === pin.programData && row.length > 45);
    assert.equal(fullReads.reduce((bytes, row) => bytes + row.length, 0), pin.space);
  }
  await assert.rejects(f.submit(), /Only a signed, never-submitted intent/);
  assert.equal(f.control.rpc.filter(method => method === 'sendTransaction').length, 1);
});

test('V14 journal failure prevents any network worker or send', async t => {
  const f = await mainFixture(t);
  f.control.failJournal = true;
  await assert.rejects(f.submit(), /Synthetic journal failure/);
  assert.equal((await f.read()).state, 'signed');
  assert.deepEqual([f.control.jobs, f.control.rpc], [[], []]);
});

for (const [name, change, sends] of [
  ['simulation refusal', control => {control.simulationError = 'Synthetic failure';}, 0],
  ['expired network blockhash', control => {control.blockhashValid = false;}, 0],
  ['inconsistent canonical block height', control => {control.heightMismatch = true;}, 0],
  ['wrong executable loader', control => {control.programIdentity = {executable: true, owner: '11111111111111111111111111111111'};}, 0],
  ['null executable identity', control => {control.programIdentity = null;}, 0],
  ['missing executable flag', control => {control.programIdentity = {owner: HINKAL_SOLANA.pin.loader};}, 0],
  ['non-executable pinned identity', control => {control.programIdentity = {executable: false, owner: HINKAL_SOLANA.pin.loader};}, 0],
  ['native-loader pinned identity', control => {control.programIdentity = {executable: true, owner: 'NativeLoader1111111111111111111111111111111'};}, 0],
  ['corrupted deployed executable bytes', control => {control.badProgramBytes = true;}, 0],
  ['mismatched RPC acknowledgement', control => {control.wrongAcknowledgement = true;}, 1],
]) test(`V14 ${name} keeps the saved hash uncertain without an automatic retry`, async t => {
  const f = await mainFixture(t);
  change(f.control);
  await assert.rejects(f.submit(), /Submission result unknown/);
  const persisted = await f.read();
  assert.equal(persisted.state, 'uncertain');
  assert.deepEqual(persisted.response, f.response);
  await assert.rejects(f.submit(), /Only a signed, never-submitted intent/);
  assert.deepEqual(f.control.jobs, ['hinkal-solana-broadcast']);
  assert.equal(f.control.rpc.filter(method => method === 'sendTransaction').length, sends);
});

for (const options of [{expired: true}, {badSignature: true}, {initialState: 'submitting'}]) {
  test(`V14 ${Object.keys(options)[0]} fails before native confirmation, journal transition or worker`, async t => {
    const f = await mainFixture(t, options);
    await assert.rejects(f.submit());
    assert.deepEqual([f.control.dialogs, f.control.jobs, f.control.journal, f.control.rpc], [[], [], [], []]);
    if (options.expired || options.badSignature) {
      await assert.rejects(f.adapter.broadcast(f.request, f.response));
      assert.deepEqual(f.control.rpc, []);
    }
  });
}

test('another intent version keeps the separate preflight before durable submission', async t => {
  const f = await mainFixture(t, {ethereum: true});
  assert.deepEqual(await f.submit(), {submitted: true});
  assert.deepEqual(f.control.jobs, ['preflight', 'broadcast']);
  assert.deepEqual(f.control.journal, ['submitting', 'pending']);
});

function unsignedPlan(fixture) {
  const {request, control} = fixture;
  control.freshHash = Keypair.generate().publicKey.toBase58();
  return {...plan, from: request.from, recipient: request.recipient, blockhash: request.blockhash,
    unsignedTransaction: request.unsignedTransaction};
}

test('V14 preparation selects the final hash after rent and pinned executable reads and simulates only final bytes', async t => {
  const f = await mainFixture(t), draft = unsignedPlan(f);
  const original = structuredClone(draft);
  const prepared = await f.adapter.prepare(draft, f.wallet);
  assert.deepEqual(draft, original);
  assert.equal(prepared.blockhash, f.control.freshHash);
  assert.equal(prepared.lastValidBlockHeight, 1200);
  assert.equal(prepared.maximumFee, '5000');
  assert.equal(prepared.accountRent, '0');
  assert.equal(prepared.fingerprint, hinkalSolanaFingerprint(prepared));
  const hashRead = f.control.rpc.indexOf('getLatestBlockhash');
  assert.ok(hashRead > f.control.rpc.indexOf('getMinimumBalanceForRentExemption'));
  assert.ok(hashRead < f.control.rpc.indexOf('isBlockhashValid'));
  assert.ok(hashRead < f.control.rpc.lastIndexOf('getMinimumBalanceForRentExemption'));
  assert.deepEqual(f.control.rpc.slice(-3), ['getBalance', 'getFeeForMessage', 'simulateTransaction']);
  assert.equal(f.control.feeReads, 2);
  for (const {pin} of programs) {
    const slices = f.control.programSlices.filter(row => row.address === pin.programData);
    assert.equal(slices.filter(row => !row.afterFinalHash && row.length > 45).reduce((sum, row) => sum + row.length, 0), pin.space);
    assert.ok(slices.some(row => row.afterFinalHash && row.offset === 0 && row.length === 45));
  }
  const tx = VersionedTransaction.deserialize(Buffer.from(prepared.unsignedTransaction, 'base64'));
  assert.ok(tx.signatures[0].every(byte => byte === 0));
  assert.equal(tx.message.recentBlockhash, f.control.freshHash);
  assert.equal((await f.read()).state, 'signed');
  assert.deepEqual([f.control.jobs, f.control.journal], [[], []]);
});

for (const [field, error] of [
  ['cursorMoved', /unapproved root bucket/], ['rentIncreased', /rent increased/], ['deploymentChanged', /deployment changed/],
  ['balanceDropped', /Insufficient Hinkal deposit balance/], ['feeIncreased', /fee increased/],
]) test(`V14 preparation rejects ${field} after choosing the final hash`, async t => {
  const f = await mainFixture(t), draft = unsignedPlan(f);
  f.control[field] = true;
  await assert.rejects(f.adapter.prepare(draft, f.wallet), error);
  assert.equal(f.control.hashSelected, true);
  assert.ok(!f.control.rpc.includes('simulateTransaction') && !f.control.rpc.includes('sendTransaction'));
  assert.deepEqual([f.control.jobs, f.control.journal], [[], []]);
});
