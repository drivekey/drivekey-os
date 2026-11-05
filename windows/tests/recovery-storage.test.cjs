'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
const {test} = require('node:test');
const {createRecoveryStorage} = require('../tools/recovery-storage.cjs');
const {TransactionStore} = require('../transaction-store.cjs');

async function profile(t) {
  const base = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(base, 'drivekey-journal-')));
  assert.equal(path.dirname(directory),base);
  assert.ok(path.basename(directory).startsWith('drivekey-journal-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  return directory;
}

test('the first protected journal write survives forced process termination on Windows', {skip:process.platform!=='win32'}, async t => {
  const directory=await profile(t), wallet=randomUUID(), id='0x'+'1'.repeat(64);
  const record={version:1,state:'prepared',request:{version:8,deviceId:wallet,fingerprint:id,requestId:randomUUID()}};
  const script=`const {createRecoveryStorage}=require(${JSON.stringify(require.resolve('../tools/recovery-storage.cjs'))});
    const {TransactionStore}=require(${JSON.stringify(require.resolve('../transaction-store.cjs'))});
    const p=${JSON.stringify(directory)};
    const store=new TransactionStore(require('path').join(p,'transactions-v1'),createRecoveryStorage(p,{}).forJournal('transactions'));
    store.put(${JSON.stringify(record)}).then(()=>{process.stdout.write('record-persisted');setInterval(()=>{},1000);},()=>process.exit(1));`;
  const child=spawn(process.execPath,['-e',script],{windowsHide:true,timeout:10000,stdio:['ignore','pipe','ignore']});
  await new Promise((resolve,reject)=>{
    let ready=false,text='';
    child.once('error',reject);
    child.once('close',()=>ready?resolve():reject(Error('Journal fixture did not complete its first write.')));
    child.stdout.on('data',chunk=>{text+=chunk;if(!ready&&text==='record-persisted'){ready=true;child.kill();}});
  });
  const storage=createRecoveryStorage(directory,{});
  const fresh=new TransactionStore(path.join(directory,'transactions-v1'),storage.forJournal('transactions'));
  assert.deepEqual(await fresh.load(wallet,id),record);
  await fs.unlink(path.join(directory,'journal-key-v1.dpapi'));
  const missing=createRecoveryStorage(directory,{});
  await assert.rejects(()=>missing.ready(),/journal key is missing/);
  await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});
});

test('legacy journals remain readable and new journals reject wrong contexts, corruption, and missing keys', {skip:process.platform!=='win32'}, async t => {
  const directory=await profile(t), safeStorage={isAsyncEncryptionAvailable:async()=>true,
    decryptStringAsync:async bytes=>({result:bytes.toString()==='legacy-fixture'?'legacy record':null})};
  const storage=createRecoveryStorage(directory,safeStorage), tx=storage.forJournal('transactions'), signatures=storage.forJournal('signatures');
  assert.equal(await tx.unseal(Buffer.from('legacy-fixture')),'legacy record');
  await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});
  const both=await Promise.all([tx.seal('first'),tx.seal('second')]);
  assert.deepEqual(await Promise.all(both.map(bytes=>tx.unseal(bytes))),['first','second']);
  await assert.rejects(()=>signatures.unseal(both[0]));
  await assert.rejects(()=>createRecoveryStorage(path.join(directory,'other'),safeStorage).forJournal('transactions').unseal(both[0]),{code:'ENOENT'});
  const damaged=Buffer.from(both[0]);damaged[damaged.length-1]^=1;
  await assert.rejects(()=>tx.unseal(damaged));
  assert.equal(await tx.unseal(both[0]),'first');
  await fs.unlink(path.join(directory,'journal-key-v1.dpapi'));
  await assert.rejects(()=>tx.seal('key no longer durable'),/Signing is disabled/);
});

test('a valid key from another same-user profile cannot add records to existing journals', {skip:process.platform!=='win32'}, async t => {
  const directory = await profile(t);
  const other = await profile(t);
  const wallet = randomUUID();
  const keyName = 'journal-key-v1.dpapi';
  const keyFile = path.join(directory, keyName);
  const journalDirectory = path.join(directory, 'signatures-v1', wallet);
  const recordFile = path.join(journalDirectory, 'a'.repeat(64) + '.bin');
  const current = createRecoveryStorage(directory, {});
  const original = await current.forJournal('signatures').seal('original signature fixture');
  await fs.mkdir(journalDirectory, {recursive: true});
  await fs.writeFile(recordFile, original);
  const savedKey = await fs.readFile(keyFile);
  await createRecoveryStorage(other, {}).ready();
  await fs.copyFile(path.join(other, keyName), keyFile);

  const replacement = createRecoveryStorage(directory, {});
  await assert.rejects(() => replacement.ready(), /existing record could not be verified/);
  await assert.rejects(() => replacement.forJournal('transactions').seal('mixed record'), /existing record could not be verified/);
  assert.deepEqual(await fs.readFile(recordFile), original);
  assert.deepEqual(await fs.readFile(keyFile), await fs.readFile(path.join(other, keyName)));

  await fs.writeFile(keyFile, savedKey);
  const restored = createRecoveryStorage(directory, {});
  await restored.ready();
  assert.equal(await restored.forJournal('signatures').unseal(original), 'original signature fixture');
  const next = await restored.forJournal('transactions').seal('valid new record');
  assert.equal(await restored.forJournal('transactions').unseal(next), 'valid new record');
});
