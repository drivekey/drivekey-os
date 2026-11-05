'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const samePath = (left, right) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right;

function directoryIdentity(directory) {
  if (!path.isAbsolute(directory)) throw Error('Choose a local absolute folder.');
  const absolute = path.resolve(directory);
  if (absolute.startsWith('\\\\')) throw Error('Choose a local absolute folder.');
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync(absolute), absolute)) {
    throw Error('Exchange folder must be a real local directory.');
  }
  return {path: absolute, dev: stat.dev, ino: stat.ino};
}

function assertDirectory(identity) {
  const actual = directoryIdentity(identity.path);
  if (actual.dev !== identity.dev || actual.ino !== identity.ino) throw Error('Exchange folder changed.');
}

function readJSON(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 256 * 1024) {
    throw Error('Exchange file must be a regular JSON file smaller than 256 KiB.');
  }
  const fd = fs.openSync(file, 'r');
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw Error('Exchange file changed while opening.');
    }
    const buffer = Buffer.alloc(256 * 1024 + 1);
    try {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (bytesRead > 256 * 1024) throw Error('Exchange file exceeds size limit.');
      try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, bytesRead)));}
      catch {throw Error('The exchange file is not valid UTF-8 JSON.');}
    } finally {buffer.fill(0);}
  } finally {fs.closeSync(fd);}
}

class RequestExchange {
  clear() {this.selected = null; this.exported = null;}
  clearBinding() {this.exported = null;}

  choose(directory, scope) {
    if (typeof scope !== 'string' || !scope) throw Error('Choose a public wallet first.');
    this.selected = {...directoryIdentity(directory), scope};
    this.exported = null;
    return {folder: path.basename(this.selected.path)};
  }

  available(scope) {return Boolean(this.selected && this.selected.scope === scope);}

  export(request, token, scope) {
    if (!this.available(scope) || typeof token !== 'string' || !token) throw Error('Choose an exchange folder for this wallet.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId)) throw Error('Invalid request identifier.');
    assertDirectory(this.selected);
    const directory = path.join(this.selected.path, request.requestId);
    fs.mkdirSync(directory);
    const identity = directoryIdentity(directory);
    const file = path.join(directory, 'request.json');
    const fd = fs.openSync(file, 'wx', 0o600);
    try {fs.writeFileSync(fd, JSON.stringify(request, null, 2) + '\n'); fs.fsyncSync(fd);}
    finally {fs.closeSync(fd);}
    assertDirectory(this.selected);
    assertDirectory(identity);
    this.exported = {identity, scope, token, fingerprint: request.fingerprint, digest: digest(request)};
    return {saved: true, exchangeFolder: true, folder: path.basename(this.selected.path), requestDirectory: request.requestId};
  }

  response(request, token, scope) {
    const binding = this.exported;
    if (!this.available(scope) || !binding || binding.scope !== scope || binding.token !== token ||
        binding.fingerprint !== request.fingerprint || binding.digest !== digest(request)) {
      throw Error('Export this exact reviewed request before importing its response.');
    }
    assertDirectory(this.selected);
    assertDirectory(binding.identity);
    if (digest(readJSON(path.join(binding.identity.path, 'request.json'))) !== binding.digest) throw Error('Exported request was changed.');
    const data = readJSON(path.join(binding.identity.path, 'signed-response.json'));
    assertDirectory(this.selected);
    assertDirectory(binding.identity);
    if (data?.fingerprint !== binding.fingerprint) throw Error('Response belongs to a different request.');
    return {data};
  }
}

module.exports = {RequestExchange};
