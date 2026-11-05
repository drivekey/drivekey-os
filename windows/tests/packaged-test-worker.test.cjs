'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {packagedTestWorker} = require('../tools/packaged-test-worker.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drivekey-package-transport-'));
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const relative = path.join('builds', 'DriveKey Offline Companion-win32-x64');
  const files = {
    node: path.join(relative, 'resources/node.exe'),
    worker: path.join(relative, 'resources/app.asar.unpacked/dist/worker.cjs'),
    executable: path.join(relative, 'DriveKey Offline Companion.exe'),
    archive: path.join(relative, 'resources/app.asar'),
  };
  const write = (name, value) => {const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, typeof value === 'object' ? JSON.stringify(value) : value);};
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const [name, file] of Object.entries(files)) write(file, name);
  const runtime = {'node.exe': hash('node'), 'dist/worker.cjs': hash('worker')};
  const build = {sourceFingerprint: 'fixture-source', binaryHashes: {'worker.cjs': hash('worker')}};
  const manifest = {builds: [{kind: 'offline', directory: relative, executable: files.executable, sha256: hash('executable'), asarSHA256: hash('archive')}]};
  const tested = {passed: true, sourceFingerprint: build.sourceFingerprint, builds: [{kind: 'offline', executableSHA256: hash('executable'), asarSHA256: hash('archive'), runtime}]};
  const save = () => {write('BUILD-MANIFEST.json', build); write('WINDOWS-BUILDS.json', manifest); write('RUNTIME-INTEGRITY.json', runtime); write('verification/ui-packaged/UI-PACKAGED.json', tested);};
  save();
  return {root, files, write, save, build, manifest, runtime, tested};
}

test('protected chain transport selects only the verified offline package', t => {
  const value = fixture(t);
  const result = packagedTestWorker(value.root);
  assert.equal(result.node, path.join(value.root, value.files.node));
  assert.equal(result.worker, path.join(value.root, value.files.worker));
});

test('package transport rejects changed source, unknown paths and ambiguous packages', t => {
  for (const change of [
    value => { value.tested.passed = false; },
    value => { value.tested.sourceFingerprint = 'old-source'; },
    value => { value.manifest.builds.push({...value.manifest.builds[0]}); },
    value => { value.manifest.builds[0].directory = '../other'; },
    value => { value.manifest.builds[0].executable = path.join(value.root, 'elsewhere.exe'); },
    value => { value.tested.builds[0].executableSHA256 = '0'.repeat(64); },
  ]) {
    const value = fixture(t);
    change(value);
    value.save();
    assert.throws(() => packagedTestWorker(value.root));
  }
});

test('package transport rejects mutations to every executable artifact', t => {
  for (const name of ['node', 'worker', 'executable', 'archive']) {
    const value = fixture(t);
    value.write(value.files[name], 'changed');
    assert.throws(() => packagedTestWorker(value.root));
  }
});

test('package transport rejects a same-hash worker junction inside the candidate', t => {
  const value = fixture(t);
  const original = path.dirname(path.join(value.root, value.files.worker));
  const alternate = path.join(value.root, 'alternate-worker');
  fs.renameSync(original, alternate);
  fs.symlinkSync(alternate, original, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => packagedTestWorker(value.root), /redirected/);
});
