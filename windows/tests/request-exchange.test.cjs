'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {RequestExchange} = require('../tools/request-exchange.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-exchange-test-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const exchange = new RequestExchange();
  const request = {requestId:randomUUID(), fingerprint:'0x'+'1'.repeat(64), amount:'1'};
  exchange.choose(directory, 'window/wallet/public-identity');
  return {directory, exchange, request, scope:'window/wallet/public-identity', token:randomUUID()};
}

test('exchange exports exact request and reads only its matching response', t => {
  const f = fixture(t);
  const result = f.exchange.export(f.request, f.token, f.scope);
  assert.equal(result.saved, true);
  const directory = path.join(f.directory, f.request.requestId);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'request.json'))), f.request);
  const response = {fingerprint:f.request.fingerprint, rawSignedTransaction:'synthetic'};
  fs.writeFileSync(path.join(directory, 'signed-response.json'), JSON.stringify(response));
  assert.deepEqual(f.exchange.response(f.request, f.token, f.scope).data, response);
  assert.throws(() => f.exchange.export(f.request, f.token, f.scope), /exist/i);
});

test('exchange rejects changed scope, token, terms, fingerprint and cleared review', t => {
  const f = fixture(t);
  f.exchange.export(f.request, f.token, f.scope);
  for (const [request,token,scope] of [
    [f.request, f.token, 'other-wallet'], [f.request, 'other-review', f.scope],
    [{...f.request, amount:'2'}, f.token, f.scope],
    [{...f.request, fingerprint:'0x'+'2'.repeat(64)}, f.token, f.scope],
  ]) assert.throws(() => f.exchange.response(request, token, scope), /exact reviewed request/);
  f.exchange.clearBinding();
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /exact reviewed request/);
  assert.equal(f.exchange.available(f.scope), true);
  f.exchange.clear();
  assert.equal(f.exchange.available(f.scope), false);
});

test('exchange rejects altered exported terms and wrong response fingerprint', t => {
  const f = fixture(t);
  f.exchange.export(f.request, f.token, f.scope);
  const directory = path.join(f.directory, f.request.requestId);
  fs.writeFileSync(path.join(directory, 'signed-response.json'), JSON.stringify({fingerprint:'wrong'}));
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /different request/);
  fs.writeFileSync(path.join(directory, 'request.json'), JSON.stringify({...f.request,amount:'2'}));
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /request was changed/);
});

test('exchange rejects traversal, preexisting child, oversized and hardlinked response', t => {
  const f = fixture(t);
  assert.throws(() => f.exchange.export({...f.request,requestId:'../escape'}, f.token, f.scope), /identifier/);
  f.exchange.export(f.request, f.token, f.scope);
  const file = path.join(f.directory, f.request.requestId, 'signed-response.json');
  fs.writeFileSync(file, ' '.repeat(256*1024+1));
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /regular JSON/);
  fs.writeFileSync(file, JSON.stringify({fingerprint:f.request.fingerprint}));
  fs.linkSync(file, path.join(f.directory,'linked-response.json'));
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /regular JSON/);
});

test('exchange rejects redirected or replaced directories', t => {
  const f = fixture(t);
  const alternate = fs.mkdtempSync(path.join(f.directory,'alternate-'));
  const redirected = path.join(f.directory,'redirected');
  fs.symlinkSync(alternate, redirected, process.platform==='win32'?'junction':'dir');
  assert.throws(() => f.exchange.choose(redirected, f.scope), /real local directory/);
  f.exchange.export(f.request, f.token, f.scope);
  const directory = path.join(f.directory, f.request.requestId);
  fs.renameSync(directory, directory+'-preserved');
  fs.mkdirSync(directory);
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /folder changed/);
});

test('exchange rejects relative paths, network paths and malformed UTF-8', t => {
  const f = fixture(t);
  assert.throws(() => f.exchange.choose('relative-folder', f.scope), /absolute folder/);
  if (process.platform === 'win32') {
    for (const network of ['\\\\server\\share', '//server/share', '\\\\?\\C:\\folder']) {
      assert.throws(() => f.exchange.choose(network, f.scope), /absolute folder/);
    }
  }
  f.exchange.export(f.request, f.token, f.scope);
  const file = path.join(f.directory, f.request.requestId, 'signed-response.json');
  fs.writeFileSync(file, Buffer.from([0xc3, 0x28]));
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), /^Error: The exchange file is not valid UTF-8 JSON\.$/);
  fs.writeFileSync(file, 'SENSITIVE-EXCHANGE-SENTINEL malformed JSON');
  assert.throws(() => f.exchange.response(f.request, f.token, f.scope), error => {
    assert.equal(error.message, 'The exchange file is not valid UTF-8 JSON.');
    assert.equal(error.message.includes('SENSITIVE-EXCHANGE-SENTINEL'), false);
    return true;
  });
});

