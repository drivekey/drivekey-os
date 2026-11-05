const {test}=require('node:test'),assert=require('node:assert/strict'),{Wallet,encryptKeystoreJson,Transaction}=require('ethers'),{Keypair}=require('@solana/web3.js'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises');
const {importLocalEthereumKey,importLocalEthereumKeystore,checkedEthereumKeystore}=require('../dist/keystore-import.cjs');
const root=path.resolve(__dirname,'..'),pass='Disposable new encrypted keystore credential 2026!',old='Disposable original keystore credential 2026!';
test('bounded PBKDF2 Ethereum V3 keystores decrypt and re-encrypt with exact identity',async()=>{
 const crypto=require('node:crypto'),w=Wallet.createRandom(),salt=crypto.randomBytes(32),iv=crypto.randomBytes(16),derived=crypto.pbkdf2Sync(old,salt,10000,32,'sha256'),key=Buffer.from(w.privateKey.slice(2),'hex');
 try{const cipher=crypto.createCipheriv('aes-128-ctr',derived.subarray(0,16),iv),encrypted=Buffer.concat([cipher.update(key),cipher.final()]),v={version:3,address:w.address.slice(2).toLowerCase(),crypto:{cipher:'aes-128-ctr',cipherparams:{iv:iv.toString('hex')},ciphertext:encrypted.toString('hex'),kdf:'pbkdf2',kdfparams:{dklen:32,c:10000,prf:'hmac-sha256',salt:salt.toString('hex')},mac:require('ethers').keccak256(Buffer.concat([derived.subarray(16),encrypted])).slice(2)}};
  assert.equal((await importLocalEthereumKeystore(v,old,pass,w.address)).public.evmAddress,w.address);v.crypto.kdfparams.c=1;assert.throws(()=>checkedEthereumKeystore(v));
 }finally{derived.fill(0);key.fill(0);}
});
test('local raw-key import preserves exact EVM identity and generates an independent Solana credential',async()=>{
 const wallet=Wallet.createRandom(),v=await importLocalEthereumKey(wallet.privateKey,pass,wallet.address);
 assert.equal(v.public.evmAddress,wallet.address);assert.equal(v.version,3);assert.equal(v.kind,'drivekey-multi-vault');assert.equal(JSON.stringify(v).includes(wallet.privateKey.slice(2)),false);
 const other=await importLocalEthereumKey(wallet.privateKey,pass,wallet.address);assert.equal(other.public.evmAddress,wallet.address);assert.notEqual(other.public.solanaAddress,v.public.solanaAddress);assert.notEqual(other.public.deviceId,v.public.deviceId);
});
test('an imported encrypted vault signs through the unchanged disposable worker; no raw-key IPC action is added',async()=>{
 const w=Wallet.createRandom(),v=await importLocalEthereumKey(w.privateKey,pass,w.address),now=Date.now(),tx=Transaction.from({type:2,chainId:1,nonce:0,to:'0x1111111111111111111111111111111111111111',value:1000n,data:'0x',gasLimit:21000n,maxFeePerGas:2000000000n,maxPriorityFeePerGas:1000000000n});
 const p=require('../dist/payment.cjs'),r={version:8,action:'payment',requestId:randomUUID(),deviceId:v.public.deviceId,chain:'ethereum',network:'ethereum',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),from:w.address,recipient:tx.to,asset:'ETH',amount:'1000',maximumFee:'42000000000000',accountRent:'0',createRecipientAccount:false,blockhash:null,lastValidBlockHeight:null,unsignedTransaction:tx.unsignedSerialized};r.fingerprint=p.paymentFingerprint(r);
 const result=spawnSync(process.execPath,['--no-addons',path.join(root,'dist/worker.cjs')],{input:JSON.stringify({action:'sign',vault:v,password:pass,request:r,fingerprint:r.fingerprint}),encoding:'utf8',windowsHide:true});assert.equal(result.status,0);assert.equal((result.stdout+result.stderr).includes(w.privateKey),false);const response=JSON.parse(result.stdout);assert.equal(response.ok,true);p.verifyPaymentResponse(response.result,r,v.public);assert.equal(Transaction.from(response.result.rawSignedTransaction).from,w.address);
 const forbidden=spawnSync(process.execPath,['--no-addons',path.join(root,'dist/worker.cjs')],{input:JSON.stringify({action:'import-raw-key',key:'forbidden'}),encoding:'utf8',windowsHide:true});assert.equal(forbidden.status,1);assert.match(JSON.parse(forbidden.stdout).error,/Local signer rejected/);assert.equal(forbidden.stdout.includes('forbidden'),false);
});
test('Ethereum V3 import preserves original bytes and accepts lowercase crypto and uppercase Crypto',async()=>{
 const wallet=Wallet.createRandom(),json=await encryptKeystoreJson({address:wallet.address,privateKey:wallet.privateKey},old,{scrypt:{N:16384,r:8,p:1}}),input=JSON.parse(json);input.crypto=input.crypto??input.Crypto;delete input.Crypto;const before=JSON.stringify(input);
 assert.equal((await importLocalEthereumKeystore(input,old,pass,wallet.address)).public.evmAddress,wallet.address);assert.equal(JSON.stringify(input),before);
 const uppercase={...input,Crypto:input.crypto};delete uppercase.crypto;assert.equal((await importLocalEthereumKeystore(uppercase,old,pass,wallet.address)).public.evmAddress,wallet.address);
 await assert.rejects(()=>importLocalEthereumKeystore(input,'wrong',pass,wallet.address),e=>e.message==='Encrypted Ethereum import failed. Check the keystore, address and passphrases locally.');
 await assert.rejects(()=>importLocalEthereumKeystore(input,old,pass,Wallet.createRandom().address));
});
test('malformed or excessive KDFs, ambiguous fields and oversized keystores fail before decryption',async()=>{
 const w=Wallet.createRandom(),v=JSON.parse(await encryptKeystoreJson({address:w.address,privateKey:w.privateKey},old,{scrypt:{N:16384,r:8,p:1}}));v.crypto=v.crypto??v.Crypto;delete v.Crypto;
 for(const patch of [{n:2**30},{n:16385},{n:16384.5},{r:1024},{p:1000},{dklen:64},{N:16384},{salt:'not-hex'}]){const bad=structuredClone(v);Object.assign(bad.crypto.kdfparams,patch);assert.throws(()=>checkedEthereumKeystore(bad));}
 assert.throws(()=>checkedEthereumKeystore({...v,Crypto:v.crypto}));assert.throws(()=>checkedEthereumKeystore({...v,padding:'x'.repeat(65536)}));
 const corrupt=structuredClone(v);corrupt.crypto.mac='0'.repeat(64);await assert.rejects(()=>importLocalEthereumKeystore(corrupt,old,pass,w.address));
});
test('invalid scalars, wrong public address and mnemonic text are rejected without secret-bearing errors',async()=>{
 const w=Wallet.createRandom();for(const value of ['0x'+'0'.repeat(64),'0x'+'f'.repeat(64),'not a private key',w.privateKey]){
  await assert.rejects(()=>importLocalEthereumKey(value,pass,Wallet.createRandom().address),e=>!e.message.includes(value)&&!e.message.includes(w.privateKey));
 }await assert.rejects(()=>importLocalEthereumKey(w.privateKey,'short',w.address));
});
test('CLI refuses piped secrets, never echoes them and creates no output in noninteractive mode',async()=>{
 const w=Wallet.createRandom(),output=path.resolve(root,'../../work/noninteractive-import-'+randomUUID()),r=spawnSync(process.execPath,['--no-addons',path.join(root,'dist/local-import.cjs'),'ethereum-key',w.address,output],{input:w.privateKey,encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.equal((r.stdout+r.stderr).includes(w.privateKey),false);assert.equal((r.stdout+r.stderr).includes(w.privateKey.slice(2)),false);await assert.rejects(()=>fs.stat(output));
 const help=spawnSync(process.execPath,[path.join(root,'dist/local-import.cjs'),'--help'],{encoding:'utf8',windowsHide:true});assert.equal(help.status,0);assert.match(help.stdout,/hidden local prompts/);
});
test('provisioning dependency graph contains no online adapter, merchant or renderer code',async()=>{
 const {metafile}=await require('esbuild').build({absWorkingDir:root,entryPoints:['tools/local-import.ts'],bundle:true,platform:'node',format:'cjs',write:false,metafile:true});
 for(const name of Object.keys(metafile.inputs))assert.equal(/^(?:online|merchant|ui)\//.test(name.replaceAll('\\','/')),false);
});
