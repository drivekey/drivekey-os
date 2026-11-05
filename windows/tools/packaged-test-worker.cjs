'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

function packagedTestWorker(root) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const build = read('BUILD-MANIFEST.json');
  const tested = read('verification/ui-packaged/UI-PACKAGED.json');
  if (tested.passed !== true || tested.sourceFingerprint !== build.sourceFingerprint) throw Error('Current package verification is required.');
  const entries = read('WINDOWS-BUILDS.json').builds.filter(item => item.kind === 'offline');
  const checks = tested.builds.filter(item => item.kind === 'offline');
  if (entries.length !== 1 || checks.length !== 1) throw Error('A single verified offline package is required.');
  const entry = entries[0], check = checks[0];
  const relative = path.join('builds', 'DriveKey Offline Companion-win32-x64');
  const executable = path.join(relative, 'DriveKey Offline Companion.exe');
  if (entry.directory !== relative || entry.executable !== executable) throw Error('Unexpected offline package location.');
  const directory = path.join(root, relative);
  const transport = {node: path.join(directory, 'resources/node.exe'), worker: path.join(directory, 'resources/app.asar.unpacked/dist/worker.cjs')};
  const archive = path.join(directory, 'resources/app.asar');
  for (const file of [transport.node, transport.worker, archive, path.join(root, executable)]) {
    const expected = path.join(fs.realpathSync(root), path.relative(root, file));
    const actual = fs.realpathSync(file);
    if ((process.platform === 'win32' ? actual.toLowerCase() : actual) !== (process.platform === 'win32' ? expected.toLowerCase() : expected)) throw Error('Package file was redirected from its qualified location.');
  }
  const runtime = read('RUNTIME-INTEGRITY.json');
  if (hash(path.join(root, executable)) !== entry.sha256 || entry.sha256 !== check.executableSHA256 || hash(archive) !== entry.asarSHA256 || entry.asarSHA256 !== check.asarSHA256) throw Error('Verified package changed.');
  if (hash(transport.worker) !== build.binaryHashes['worker.cjs'] || hash(transport.worker) !== runtime['dist/worker.cjs'] || hash(transport.worker) !== check.runtime['dist/worker.cjs']) throw Error('Packaged signer differs from the qualified worker.');
  if (hash(transport.node) !== runtime['node.exe'] || hash(transport.node) !== check.runtime['node.exe']) throw Error('Packaged Node runtime changed.');
  return {...transport, evidence: {
    packageKind: 'offline',
    sourceFingerprint: build.sourceFingerprint,
    executable: path.join(root, executable),
    executableSHA256: entry.sha256,
    archive,
    archiveSHA256: entry.asarSHA256,
    node: transport.node,
    nodeSHA256: runtime['node.exe'],
    worker: transport.worker,
    workerSHA256: runtime['dist/worker.cjs'],
  }};
}
module.exports = {packagedTestWorker};
