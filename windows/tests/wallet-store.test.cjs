const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {WalletStore,cleanName,vaultDigest}=require('../wallet-store.cjs');
const work=path.resolve('work','wallet-store-tests-'+Date.now());
async function fixture(){
 await fs.mkdir(work,{recursive:true});const dir=await fs.mkdtemp(path.join(work,'case-'));
 const file=path.join(dir,'vault.json'),catalog=path.join(dir,'catalog.json');
 const encrypted={format:'disposable-test',ciphertext:'opaque encrypted payload',salt:'fixture'};
 const identity={version:3,deviceId:randomUUID(),createdAt:new Date().toISOString(),evmAddress:'0x'+'1'.repeat(40),solanaAddress:'1'.repeat(32)};
 await fs.writeFile(file,JSON.stringify(encrypted));return {dir,file,catalog,encrypted,identity};
}
test('catalog persists only public metadata and deduplicates copies of the same encrypted vault',async()=>{
 const f=await fixture(),store=await new WalletStore(f.catalog).init();
 const first=await store.upsert(f.file,f.encrypted,f.identity,'Spending'),copy=path.join(f.dir,'backup.json');await fs.copyFile(f.file,copy);
 const reopened=await store.upsert(copy,{salt:'fixture',ciphertext:'opaque encrypted payload',format:'disposable-test'},f.identity);
 assert.equal(reopened.id,first.id);assert.equal(store.list().wallets.length,1);
 const raw=await fs.readFile(f.catalog,'utf8');assert.equal(raw.includes('opaque encrypted payload'),false);assert.equal(raw.includes('ciphertext'),false);
 const restarted=await new WalletStore(f.catalog).init();assert.equal(restarted.list().wallets[0].name,'Spending');assert.equal(restarted.list().activeId,null);assert.equal(restarted.list().wallets[0].backupVerified,false);
 assert.equal(JSON.stringify(restarted.list()).includes(f.dir),false);
});
test('failed atomic catalog replacement preserves prior records and disk bytes',async()=>{
 const f=await fixture(),store=await new WalletStore(f.catalog).init(),record=await store.upsert(f.file,f.encrypted,f.identity,'Savings'),before=await fs.readFile(f.catalog);
 const failed=await new WalletStore(f.catalog,{fs:{...fs,rename:async()=>{throw Error('Injected disk replacement failure');}}}).init();
 await assert.rejects(failed.rename(record.id,'Changed'),/Could not save/);assert.equal(failed.get(record.id).name,'Savings');assert.deepEqual(await fs.readFile(f.catalog),before);
 assert.equal((await fs.readdir(f.dir)).some(file=>file.endsWith('.tmp')),false);
});
test('damaged persisted catalog fails closed and is never overwritten by another operation',async()=>{
 const f=await fixture(),bad='{ damaged catalog';await fs.writeFile(f.catalog,bad);
 const store=new WalletStore(f.catalog);await assert.rejects(store.init(),/damaged/);await assert.rejects(store.upsert(f.file,f.encrypted,f.identity,'New'),/damaged/);assert.equal(await fs.readFile(f.catalog,'utf8'),bad);
});
test('a changed encrypted body or public identity cannot replace an existing wallet registration',async()=>{
 const f=await fixture(),store=await new WalletStore(f.catalog).init(),record=await store.upsert(f.file,f.encrypted,f.identity,'Spending');
 assert.throws(()=>store.assertVault(record,{...f.encrypted,ciphertext:'different payload'},f.identity),/changed|identity/);
 await assert.rejects(store.upsert(f.file,f.encrypted,{...f.identity,evmAddress:'0x'+'2'.repeat(40)}),/changed|identity/);
 assert.equal(store.list().wallets[0].evmAddress,f.identity.evmAddress);assert.equal(vaultDigest({a:1,b:2}),vaultDigest({b:2,a:1}));
});
test('wallet names reject hidden control characters and removing a reference leaves vault files intact',async()=>{
 const f=await fixture(),store=await new WalletStore(f.catalog).init(),record=await store.upsert(f.file,f.encrypted,f.identity,'Spending');
 for(const name of ['', ' ', 'a'.repeat(41),'bad\u0000name','bad\u202ename'])assert.throws(()=>cleanName(name));
 assert.equal(cleanName('  Savings <local>  '),'Savings <local>');await store.remove(record.id);assert.equal(store.list().wallets.length,0);assert.ok((await fs.stat(f.file)).isFile());
});
