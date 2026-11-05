'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes, randomUUID} = require('node:crypto');

const format = Buffer.from('DKJR1');
const nonceLength = 12;
const tagLength = 16;
const wrappedLimit = 4096;
const journalLimit = 256 * 1024;
const journalPurposes = Object.freeze(['signatures', 'transactions', 'proofs', 'proof-requests', 'proof-results', 'signing-attempts', 'signing-results', 'signing-commitments', 'view-sessions', 'view-requests', 'view-responses', 'view-job-attempts', 'view-preparations', 'proof-finalizations', 'private-note-claims', 'private-note-chains', 'private-note-locks']);
const storageError = 'Windows encrypted recovery storage is unavailable. Signing is disabled.';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const journalContext = purpose => Buffer.from('DriveKey journal v1: ' + purpose);

// The Windows user key is managed by DPAPI, independent of Electron's delayed
// profile writes. Only a 32-byte journal key crosses this pipe.
async function dpapi(method, key) {
  if (process.platform !== 'win32' || !process.env.SystemRoot) throw Error(storageError);
  const systemRoot = process.env.SystemRoot;
  const exe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;` +
    `$stream=[IO.MemoryStream]::new();[Console]::OpenStandardInput().CopyTo($stream);$bytes=$stream.ToArray();` +
    `try{$result=[Security.Cryptography.ProtectedData]::${method}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);` +
    `[Console]::OpenStandardOutput().Write($result,0,$result.Length)}finally{` +
    `[Array]::Clear($bytes,0,$bytes.Length);[Array]::Clear($stream.GetBuffer(),0,$stream.Capacity);` +
    `if($result){[Array]::Clear($result,0,$result.Length)};$stream.Dispose()}`;
  const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env:{SystemRoot:systemRoot, WINDIR:systemRoot}, windowsHide:true, timeout:10000, stdio:['pipe','pipe','ignore'],
  });
  let length = 0;
  const chunks = [];
  child.stdout.on('data', bytes => {
    length += bytes.length;
    if (length > wrappedLimit) {bytes.fill(0);child.kill();}
    else chunks.push(bytes);
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
      child.stdin.on('error', () => {});
      child.stdin.end(key);
    });
    if (code !== 0 || !length || length > wrappedLimit) throw Error(storageError);
    return Buffer.concat(chunks);
  } catch {
    throw Error(storageError);
  } finally {for (const bytes of chunks) bytes.fill(0);}
}

async function readProtectedKey(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > wrappedLimit) throw Error(storageError);
    const bytes = Buffer.alloc(wrappedLimit + 1);
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw Error(storageError);
    return bytes.subarray(0, bytesRead);
  } finally {await handle.close();}
}

async function* protectedJournals(profile) {
  for (const purpose of journalPurposes) {
    const root = path.join(profile, purpose + '-v1');
    const rootInfo=await fs.lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!rootInfo)continue;
    if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('Redirected protected journal directory.');
    const wallets = await fs.readdir(root, {withFileTypes:true}).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if(wallets.some(entry=>entry.isSymbolicLink()))throw Error('Redirected protected wallet journal.');
    if(purpose==='private-note-locks')for(const entry of wallets.filter(entry=>!entry.isDirectory())){const handle=await fs.open(path.join(root,entry.name),'r');try{yield {handle,purpose};}finally{await handle.close();}}
    for (const wallet of wallets.filter(entry => entry.isDirectory())) {
      const scope = path.join(root, wallet.name);
      for (const file of await fs.readdir(scope)) {
        // An interrupted exclusive publication can leave the only copy of a
        // signature in its temporary file. It still depends on this profile key.
        if (purpose!=='private-note-locks'&&!/^[a-f0-9]{64}\.bin(?:\.[a-f0-9-]{36}\.tmp)?$/i.test(file)) continue;
        const location=path.join(scope,file);if((await fs.lstat(location)).isSymbolicLink())throw Error('Redirected protected journal record.');
        const handle = await fs.open(location, 'r');
        try {
          // Never use an unauthenticated header as a reason to omit a record.
          // Damaged protected ciphertext must not masquerade as an empty profile.
          yield {handle, purpose};
        } finally {await handle.close();}
      }
    }
  }
}

async function journalBytes(handle) {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size < 1 || stat.size > journalLimit) throw Error('Invalid encrypted journal size.');
  const bytes = Buffer.alloc(stat.size);
  const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
  if (bytesRead !== bytes.length) throw Error('Journal changed during verification.');
  return bytes;
}

async function legacyPlaintext(bytes, safeStorage) {
  if (process.platform !== 'win32' || typeof safeStorage?.isAsyncEncryptionAvailable !== 'function' ||
      !await safeStorage.isAsyncEncryptionAvailable() || typeof safeStorage.decryptStringAsync !== 'function') throw Error(storageError);
  const plaintext = (await safeStorage.decryptStringAsync(bytes))?.result;
  if (typeof plaintext !== 'string' || !plaintext.length || Buffer.byteLength(plaintext, 'utf8') > journalLimit) throw Error(storageError);
  return plaintext;
}

function decryptJournal(bytes, key, aad) {
  const tagStart = format.length + nonceLength;
  const bodyStart = tagStart + tagLength;
  if (bytes.length < bodyStart) throw Error('Invalid encrypted journal.');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(format.length, tagStart));
  decipher.setAAD(aad);
  decipher.setAuthTag(bytes.subarray(tagStart, bodyStart));
  const body = decipher.update(bytes.subarray(bodyStart));
  try {
    decipher.final();
    return body;
  } catch (error) {
    body.fill(0);
    throw error;
  }
}

async function authenticateExistingJournals(profile, key, safeStorage) {
  try {
    for await (const {handle, purpose} of protectedJournals(profile)) {
      const bytes = await journalBytes(handle);
      if (bytes.subarray(0, format.length).equals(format)) decryptJournal(bytes, key, journalContext(purpose)).fill(0);
      else await legacyPlaintext(bytes, safeStorage);
    }
  } catch {
    throw Error('The protected journal key or an existing record could not be verified. Preserve the profile and restore its original key state.');
  }
}

function createRecoveryStorage(profile, safeStorage) {
  const file = path.join(profile, 'journal-key-v1.dpapi');
  let pendingKey, writeCheck;

  async function provision() {
    try {
      for await (const {handle} of protectedJournals(profile)) {
        const bytes = await journalBytes(handle);
        // Only positively authenticated legacy Electron ciphertext is independent
        // of the missing journal key. Unknown or damaged bytes always fail closed.
        if (bytes.subarray(0, format.length).equals(format)) throw Error(storageError);
        await legacyPlaintext(bytes, safeStorage);
      }
    } catch {
      throw Error('The protected journal key is missing or an existing record could not be verified. Preserve this profile and restore its original key.');
    }
    const key = randomBytes(32);
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const wrapped = await dpapi('Protect', key);
      try {
        const handle = await fs.open(temp, 'wx', 0o600);
        try {await handle.writeFile(wrapped);await handle.sync();}finally{await handle.close();}
        try {await fs.link(temp, file);}catch(error){if(error.code !== 'EEXIST')throw error;}
      } finally {wrapped.fill(0);}
    } finally {key.fill(0);await fs.unlink(temp).catch(()=>{});}
  }

  function loadKey(create) {
    if (!pendingKey) pendingKey = (async () => {
      let wrapped;
      try {wrapped = await readProtectedKey(file);}
      catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
        await provision();
        wrapped = await readProtectedKey(file);
      }
      try {
        const key = await dpapi('Unprotect', wrapped);
        try {
          if (key.length !== 32) throw Error(storageError);
          return {key:createSecretKey(key), protectedDigest:digest(wrapped)};
        }
        finally {key.fill(0);}
      } finally {wrapped.fill(0);}
    })().catch(error => {pendingKey=undefined;throw error;});
    return pendingKey;
  }

  async function checkedPersistentKey({key, protectedDigest}) {
    const wrapped = await readProtectedKey(file).catch(() => {throw Error(storageError);});
    try {
      if (digest(wrapped) !== protectedDigest) throw Error(storageError);
      return key;
    } finally {wrapped.fill(0);}
  }

  async function keyForWrite() {
    const loaded = await loadKey(true), {key} = loaded;
    // DPAPI proves that this user can open the key, not that it belongs to this profile.
    // Recheck before each write batch, rather than caching success forever.
    // Corruption discovered after a prior successful write must still stop signing.
    writeCheck ??= authenticateExistingJournals(profile, key, safeStorage).finally(() => {writeCheck=undefined;});
    await writeCheck;
    return checkedPersistentKey(loaded);
  }

  function forJournal(purpose) {
    if (!journalPurposes.includes(purpose)) throw Error('Unsupported journal purpose. Register it in the key-preservation scan first.');
    const aad = journalContext(purpose);
    return {
      async seal(text) {
        const key = await keyForWrite();
        const nonce = randomBytes(nonceLength);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(aad);
        const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        return Buffer.concat([format, nonce, cipher.getAuthTag(), body]);
      },
      async unseal(bytes) {
        if (!bytes.subarray(0, format.length).equals(format)) {
          return legacyPlaintext(bytes, safeStorage);
        }
        // Cached key bytes do not authorize access after the persisted key is
        // lost or replaced. Never provision or silently rebind during a read.
        const key = await checkedPersistentKey(await loadKey(false));
        const body = decryptJournal(bytes, key, aad);
        try {return body.toString('utf8');}
        finally {body.fill(0);}
      },
    };
  }
  return {async ready(){await keyForWrite();},forJournal};
}

module.exports = {createRecoveryStorage};
