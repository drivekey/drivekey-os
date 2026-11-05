const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {WalletStore}=require('../wallet-store.cjs');
const work=path.resolve('work','wallet-recovery-unit-'+Date.now());
async function fixture(){
 await fs.mkdir(work,{recursive:true});const dir=await fs.mkdtemp(path.join(work,'case-')),file=path.join(dir,'wallet-catalog-v1.json'),vault=path.join(dir,'vault.json');
 const encrypted={ciphertext:'disposable encrypted fixture'},identity={version:3,deviceId:randomUUID(),createdAt:new Date().toISOString(),evmAddress:'0x'+'1'.repeat(40),solanaAddress:'1'.repeat(32)};
 await fs.writeFile(vault,JSON.stringify(encrypted));return {dir,file,vault,encrypted,identity};
}
const copies=async f=>(await fs.readdir(f.dir)).filter(name=>name.includes('.damaged-'));
test('a repaired catalog can be retried in the same store after an initial load failure',async()=>{
 const f=await fixture();await fs.writeFile(f.file,'{damaged');const store=new WalletStore(f.file);await assert.rejects(store.init(),/damaged/);assert.equal(store.problem.canRecover,true);
 await fs.writeFile(f.file,JSON.stringify({version:1,wallets:[]}));await store.init();assert.equal(store.problem,null);assert.equal(store.list().wallets.length,0);assert.deepEqual(await copies(f),[]);
});
test('recovery preserves exact damaged bytes before creating an empty catalog and keeps vault files',async()=>{
 const f=await fixture(),original=Buffer.from('{ damaged catalog bytes\n\u0000');await fs.writeFile(f.file,original);const vaultBytes=await fs.readFile(f.vault),store=new WalletStore(f.file);await assert.rejects(store.init());
 assert.equal((await store.recover()).recovered,true);const backups=await copies(f);assert.equal(backups.length,1);assert.deepEqual(await fs.readFile(path.join(f.dir,backups[0])),original);
 assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),{version:1,wallets:[]});assert.deepEqual(await fs.readFile(f.vault),vaultBytes);assert.equal(store.problem,null);
 await store.upsert(f.vault,f.encrypted,f.identity,'Recovered wallet');assert.equal(store.list().wallets.length,1);
});
test('unreadable storage is retryable but cannot be overwritten as damaged data',async()=>{
 const f=await fixture();await fs.writeFile(f.file,'{damaged');const before=await fs.readFile(f.file),denied=Object.assign(Error('Denied'),{code:'EACCES'}),store=new WalletStore(f.file,{fs:{...fs,open:async(file,...args)=>{if(file===f.file)throw denied;return fs.open(file,...args);}}});
 await assert.rejects(store.init(),/could not be read/);assert.equal(store.problem.canRecover,false);await assert.rejects(store.recover(),/could not be read/);assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(await copies(f),[]);
});
test('failure to preserve the damaged catalog prevents reset',async()=>{
 const f=await fixture(),original=Buffer.from('{ original damaged list');await fs.writeFile(f.file,original);
 const store=new WalletStore(f.file,{fs:{...fs,open:async(file,...args)=>{if(String(file).includes('.damaged-'))throw Error('Injected quarantine failure');return fs.open(file,...args);}}});
 await assert.rejects(store.init());await assert.rejects(store.recover(),/Could not preserve/);assert.deepEqual(await fs.readFile(f.file),original);assert.equal(store.problem.canRecover,true);assert.equal(store.list().wallets.length,0);
});
test('failed atomic replacement retains original catalog, preserved copy and prior memory state',async()=>{
 const f=await fixture(),healthy=await new WalletStore(f.file).init();await healthy.upsert(f.vault,f.encrypted,f.identity,'Spending');const original=Buffer.from('{ now damaged');await fs.writeFile(f.file,original);
 healthy.fs={...fs,rename:async()=>{throw Error('Injected atomic replacement failure');}};await assert.rejects(healthy.retry());assert.equal(healthy.list().wallets[0].name,'Spending');
 await assert.rejects(healthy.recover(),/Could not save/);assert.deepEqual(await fs.readFile(f.file),original);assert.equal(healthy.list().wallets[0].name,'Spending');
 const backups=await copies(f);assert.equal(backups.length,1);assert.deepEqual(await fs.readFile(path.join(f.dir,backups[0])),original);assert.equal((await fs.readdir(f.dir)).some(name=>name.endsWith('.tmp')),false);
});
test('a healthy catalog repaired before recovery is retained without a reset or quarantine',async()=>{
 const f=await fixture(),healthy=await new WalletStore(f.file).init();await healthy.upsert(f.vault,f.encrypted,f.identity,'Keep this name');const healthyBytes=await fs.readFile(f.file);await fs.writeFile(f.file,'{damaged');const store=new WalletStore(f.file);await assert.rejects(store.init());await fs.writeFile(f.file,healthyBytes);
 assert.equal((await store.recover()).recovered,false);assert.equal(store.list().wallets[0].name,'Keep this name');assert.deepEqual(await fs.readFile(f.file),healthyBytes);assert.deepEqual(await copies(f),[]);
});
test('a catalog changed after its preserved copy is made is not replaced',async()=>{
 const f=await fixture(),original=Buffer.from('{ first damaged list'),changed=Buffer.from('{ externally changed list');await fs.writeFile(f.file,original);
 const store=new WalletStore(f.file,{fs:{...fs,readFile:async(file,...args)=>{const bytes=await fs.readFile(file,...args);if(String(file).includes('.damaged-'))await fs.writeFile(f.file,changed);return bytes;}}});
 await assert.rejects(store.init());await assert.rejects(store.recover(),/changed during recovery/);assert.deepEqual(await fs.readFile(f.file),changed);const backup=(await copies(f))[0];assert.deepEqual(await fs.readFile(path.join(f.dir,backup)),original);
});
