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

test('damaged journal headers cannot be ignored when provisioning a missing key', {skip:process.platform!=='win32'}, async t => {
  const directory=await profile(t),wallet=randomUUID(),recordDirectory=path.join(directory,'transactions-v1',wallet);
  await fs.mkdir(recordDirectory,{recursive:true});
  const record=Buffer.from('XKJR1 damaged encrypted record'),file=path.join(recordDirectory,'a'.repeat(64)+'.bin');
  await fs.writeFile(file,record);
  await assert.rejects(()=>createRecoveryStorage(directory,{}).ready(),/journal key is missing|existing record could not be verified/);
  await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(file),record);
});

test('a damaged header blocks new writes with the original key and after a prior successful readiness check', {skip:process.platform!=='win32'}, async t => {
  const directory=await profile(t),storage=createRecoveryStorage(directory,{}),scope=storage.forJournal('transactions');
  const original=await scope.seal('recoverable fixture'),recordDirectory=path.join(directory,'transactions-v1',randomUUID());
  await fs.mkdir(recordDirectory,{recursive:true});const file=path.join(recordDirectory,'b'.repeat(64)+'.bin');
  const damaged=Buffer.from(original);damaged[0]^=1;await fs.writeFile(file,damaged);
  const key=await fs.readFile(path.join(directory,'journal-key-v1.dpapi'));
  await assert.rejects(()=>storage.ready(),/existing record could not be verified/);
  await assert.rejects(()=>scope.seal('new write after corruption'),/existing record could not be verified/);
  await assert.rejects(()=>createRecoveryStorage(directory,{}).ready(),/existing record could not be verified/);
  assert.deepEqual(await fs.readFile(file),damaged);assert.deepEqual(await fs.readFile(path.join(directory,'journal-key-v1.dpapi')),key);
  await fs.writeFile(file,original);
  // Repair permits recovery with the same original key, including on the same instance.
  await storage.ready();assert.equal(await scope.unseal(original),'recoverable fixture');
});

test('an interrupted journal publication preserves its temporary ciphertext and blocks lost-key reprovisioning', {skip:process.platform!=='win32'}, async t => {
  const directory=await profile(t),recordDirectory=path.join(directory,'signatures-v1',randomUUID());await fs.mkdir(recordDirectory,{recursive:true});
  const file=path.join(recordDirectory,'c'.repeat(64)+'.bin.'+randomUUID()+'.tmp'),bytes=Buffer.from('DKJR1 incomplete publication');await fs.writeFile(file,bytes);
  await assert.rejects(()=>createRecoveryStorage(directory,{}).ready(),/journal key is missing|existing record could not be verified/);
  assert.deepEqual(await fs.readFile(file),bytes);await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});
});

test('authenticated legacy journals can migrate but unauthenticated legacy records block new keys', {skip:process.platform!=='win32'}, async t => {
  for(const result of ['authenticated legacy fixture',null]){
    const directory=await profile(t),recordDirectory=path.join(directory,'transactions-v1',randomUUID());await fs.mkdir(recordDirectory,{recursive:true});
    const file=path.join(recordDirectory,'d'.repeat(64)+'.bin'),bytes=Buffer.from('legacy fixture ciphertext');await fs.writeFile(file,bytes);
    const storage=createRecoveryStorage(directory,{isAsyncEncryptionAvailable:async()=>true,decryptStringAsync:async()=>({result})});
    if(result){await storage.ready();assert.equal(await storage.forJournal('transactions').unseal(bytes),result);}
    else {await assert.rejects(()=>storage.ready(),/journal key is missing|existing record could not be verified/);await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});}
    assert.deepEqual(await fs.readFile(file),bytes);
  }
});

test('unregistered journal purposes cannot create records invisible to key-preservation scans',()=>{
  assert.throws(()=>createRecoveryStorage('unused fixture directory',{}).forJournal('unregistered'),/journal purpose/);
});

test('product proof authorization journals alone prevent lost-key reprovisioning', {skip:process.platform!=='win32'}, async t=>{
  const directory=await profile(t),storage=createRecoveryStorage(directory,{}),recordDirectory=path.join(directory,'proofs-v1',randomUUID());
  const bytes=await storage.forJournal('proofs').seal('Unfunded proof authorization fixture');await fs.mkdir(recordDirectory,{recursive:true});
  const file=path.join(recordDirectory,'e'.repeat(64)+'.bin');await fs.writeFile(file,bytes);await fs.unlink(path.join(directory,'journal-key-v1.dpapi'));
  await assert.rejects(()=>createRecoveryStorage(directory,{}).ready(),/journal key is missing/);assert.deepEqual(await fs.readFile(file),bytes);
  await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});
});

test('product proof results alone preserve the original records when their journal key is missing', {skip:process.platform!=='win32'}, async t=>{
 const directory=await profile(t),storage=createRecoveryStorage(directory,{}),recordDirectory=path.join(directory,'proof-results-v1',randomUUID());
 const bytes=await storage.forJournal('proof-results').seal('Unfunded completed proof fixture');await fs.mkdir(recordDirectory,{recursive:true});const file=path.join(recordDirectory,'f'.repeat(64)+'.bin');await fs.writeFile(file,bytes);await fs.unlink(path.join(directory,'journal-key-v1.dpapi'));
 await assert.rejects(()=>createRecoveryStorage(directory,{}).ready(),/journal key is missing/);assert.deepEqual(await fs.readFile(file),bytes);await assert.rejects(()=>fs.stat(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});
});
test('cached journal keys cannot authorize reads after the protected key is removed, corrupted or replaced', {skip:process.platform!=='win32'}, async t=>{
 const directory=await profile(t),storage=createRecoveryStorage(directory,{}),scope=storage.forJournal('proof-results'),ciphertext=await scope.seal('cached-key read fixture'),keyFile=path.join(directory,'journal-key-v1.dpapi'),key=await fs.readFile(keyFile),other=await profile(t);await createRecoveryStorage(other,{}).ready();const unrelated=await fs.readFile(path.join(other,'journal-key-v1.dpapi')),damaged=Buffer.from(key);damaged[damaged.length-1]^=1;
 const records=path.join(directory,'proof-results-v1',randomUUID());await fs.mkdir(records,{recursive:true});const file=path.join(records,'a'.repeat(64)+'.bin');await fs.writeFile(file,ciphertext);assert.equal(await scope.unseal(ciphertext),'cached-key read fixture');
 for(const replacement of [null,damaged,unrelated]){
  if(replacement===null)await fs.unlink(keyFile);else await fs.writeFile(keyFile,replacement);
  await assert.rejects(scope.unseal(ciphertext));assert.deepEqual(await fs.readFile(file),ciphertext);
  if(replacement===null)await assert.rejects(fs.access(keyFile),{code:'ENOENT'});else assert.deepEqual(await fs.readFile(keyFile),replacement);
  await fs.writeFile(keyFile,key,{flag:replacement===null?'wx':'w'});assert.equal(await scope.unseal(ciphertext),'cached-key read fixture');
 }
});
test('Windows case-only journal restores remain listed and cannot bypass missing-key preservation', {skip:process.platform!=='win32'}, async t=>{
 const directory=await profile(t),wallet=randomUUID(),storage=createRecoveryStorage(directory,{}),signatures=new(require('../signature-store.cjs').SignatureStore)(path.join(directory,'signatures-v1'),storage.forJournal('signatures')),transactions=new TransactionStore(path.join(directory,'transactions-v1'),storage.forJournal('transactions'));
 const a={deviceId:wallet,requestId:randomUUID(),fingerprint:'0x'+'a'.repeat(64)},b={version:8,deviceId:wallet,requestId:randomUUID(),fingerprint:'0x'+'b'.repeat(64)};await signatures.save(wallet,a,{deviceId:wallet,requestId:a.requestId,fingerprint:a.fingerprint,signedAt:new Date().toISOString()});await transactions.put({version:1,request:b,state:'prepared'});
 const files=[];for(const original of [signatures.location(wallet,a.fingerprint.slice(2)),transactions.file(wallet,b.fingerprint)]){const upper=path.join(path.dirname(original),path.basename(original).toUpperCase()),bytes=await fs.readFile(original);await fs.rename(original,upper);files.push({file:upper,bytes});}
 assert.equal((await signatures.list(wallet)).length,1);assert.equal((await transactions.list(wallet)).length,1);const keyFile=path.join(directory,'journal-key-v1.dpapi'),key=await fs.readFile(keyFile);await fs.unlink(keyFile);await assert.rejects(createRecoveryStorage(directory,{}).ready(),/journal key is missing/);await assert.rejects(fs.access(keyFile),{code:'ENOENT'});for(const f of files)assert.deepEqual(await fs.readFile(f.file),f.bytes);await fs.writeFile(keyFile,key,{flag:'wx'});assert.equal((await signatures.list(wallet)).length,1);
});

test('signing attempts and result-only journals preserve ciphertext and cannot reprovision a missing key', {skip:process.platform!=='win32'}, async t=>{
 for(const purpose of ['signing-attempts','signing-results']){const directory=await profile(t),storage=createRecoveryStorage(directory,{}),records=path.join(directory,purpose+'-v1',randomUUID());await fs.mkdir(records,{recursive:true});const bytes=await storage.forJournal(purpose).seal('Unfunded signing recovery fixture'),file=path.join(records,'a'.repeat(64)+'.bin.'+randomUUID()+'.tmp');await fs.writeFile(file,bytes);await fs.unlink(path.join(directory,'journal-key-v1.dpapi'));await assert.rejects(createRecoveryStorage(directory,{}).ready(),/journal key is missing/);assert.deepEqual(await fs.readFile(file),bytes);await assert.rejects(fs.access(path.join(directory,'journal-key-v1.dpapi')),{code:'ENOENT'});}
});
