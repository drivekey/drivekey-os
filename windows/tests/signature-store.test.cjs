const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const {SignatureStore}=require('../signature-store.cjs');
const work=path.resolve(__dirname,'../../../work/signature-store-'+Date.now());
async function fixture(io){
 const directory=path.join(work,randomUUID()),walletId=randomUUID(),id='a'.repeat(64),key=randomBytes(32);
 const options={io,seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]);},unseal:async bytes=>{const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');}};
 const store=new SignatureStore(directory,options),request={deviceId:walletId,requestId:randomUUID(),fingerprint:'0x'+id,network:'ethereum'},response={deviceId:walletId,requestId:request.requestId,fingerprint:request.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:'transferable-fixture-signature',transactionHash:'0x'+'b'.repeat(64)};
 return {directory,walletId,id,options,store,request,response};
}
test('encrypted response survives a new store instance; vaults and passphrases are not saved',async()=>{
 const f=await fixture();await f.store.save(f.walletId,f.request,f.response);
 const bytes=await fs.readFile(f.store.location(f.walletId,f.id));assert.equal(bytes.includes(Buffer.from(f.response.rawSignedTransaction)),false);
 const reloaded=await new SignatureStore(f.directory,f.options).load(f.walletId,f.id);assert.deepEqual(reloaded.response,f.response);assert.equal(JSON.stringify(reloaded).includes('password'),false);assert.equal((await f.store.list(f.walletId)).length,1);
});
test('identity, wallet, traversal, changed payload and damaged ciphertext fail closed',async()=>{
 const f=await fixture();await f.store.save(f.walletId,f.request,f.response);assert.equal(await f.store.load(randomUUID(),f.id),null);
 await assert.rejects(f.store.load(f.walletId,'../arbitrary'));await assert.rejects(f.store.save(f.walletId,f.request,{...f.response,deviceId:randomUUID()}));
 const file=f.store.location(f.walletId,f.id),bytes=await fs.readFile(file);bytes[bytes.length-1]^=1;await fs.writeFile(file,bytes);await assert.rejects(f.store.load(f.walletId,f.id),/damaged/);assert.deepEqual(await fs.readFile(file),bytes);
});
test('existing records are never overwritten and conflicting requests are rejected',async()=>{
 const f=await fixture();await f.store.save(f.walletId,f.request,f.response);const file=f.store.location(f.walletId,f.id),before=await fs.readFile(file);
 const existing=await f.store.save(f.walletId,f.request,{...f.response,rawSignedTransaction:'new signature'});assert.deepEqual(existing.response,f.response);assert.deepEqual(await fs.readFile(file),before);
 await assert.rejects(f.store.save(f.walletId,{...f.request,network:'solana'},f.response),/conflicts/);assert.deepEqual(await fs.readFile(file),before);
});
test('failed durable publication leaves no recoverable response and no temporary file',async()=>{
 const f=await fixture({...fs,link:async()=>{throw Error('Injected write failure');}});
 await assert.rejects(f.store.save(f.walletId,f.request,f.response),/write failure/);assert.equal(await f.store.load(f.walletId,f.id),null);assert.deepEqual(await fs.readdir(path.join(f.directory,f.walletId)),[]);
});
test('encryption failure prevents any plaintext fallback',async()=>{
 const f=await fixture();const store=new SignatureStore(f.directory,{...f.options,seal:async()=>{throw Error('Encryption unavailable');}});
 await assert.rejects(store.save(f.walletId,f.request,f.response),/Encryption unavailable/);await assert.rejects(fs.stat(f.directory));
});

