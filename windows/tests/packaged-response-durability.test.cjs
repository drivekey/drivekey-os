'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {persistSignedResponse, dpapi} = require('../tools/protected-test-profile.cjs');

test('execution-evidence write failure preserves the encrypted synthetic response', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-response-durability-'));
  assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const base = path.join(directory, 'synthetic-response');
  const response = {fixtureOnly: true, message: 'synthetic data with no key or signature'};
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', function(file, ...args) {
    if (String(file).includes('.execution.json.')) throw Error('Injected evidence-file failure');
    return open.call(fs, file, ...args);
  });
  assert.throws(() => persistSignedResponse(base, response, {state: 'exited'}), /Injected evidence-file failure/);
  assert.equal(fs.existsSync(base + '.response.dpapi'), true);
  const plain = dpapi('unprotect', fs.readFileSync(base + '.response.dpapi'));
  try {
    assert.deepEqual(JSON.parse(plain.toString()), response);
  } finally {
    plain.fill(0);
  }
  assert.equal(fs.existsSync(base + '.execution.json'), false);
});
