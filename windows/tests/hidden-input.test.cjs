const {test}=require('node:test'),assert=require('node:assert/strict'),{PassThrough,Writable}=require('node:stream'),{randomUUID}=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises');
const {Wallet}=require('ethers'),root=path.resolve(__dirname,'..');
const {createHiddenTerminal}=require('../dist/hidden-input.cjs'),{runLocalImport,safeImportFailure}=require('../dist/local-import.cjs');
function terminal(){const input=new PassThrough(),output=new Writable({write(b,_e,done){transcript.push(b.toString());done();}}),transcript=[],modes=[];input.isTTY=true;input.setRawMode=v=>{modes.push(v);return input;};output.isTTY=true;output.columns=80;const previousTerm=process.env.TERM;process.env.TERM="xterm-256color";let session;try{session=createHiddenTerminal(input,output);}finally{if(previousTerm===undefined)delete process.env.TERM;else process.env.TERM=previousTerm;}return {input,output,transcript,modes,session};}
test('hidden terminal accepts typed and pasted input across prompts without echoing credentials',async()=>{
 const t=terminal();try{let pending=t.session.read('Key: ');t.input.write('generated-fixture-secret\r');assert.equal(await pending,'generated-fixture-secret');pending=t.session.read('Passphrase: ');t.input.write('a long test passphrase\r');assert.equal(await pending,'a long test passphrase');assert.equal(t.transcript.join(''),'Key: \nPassphrase: \n');}finally{t.session.close();}assert.equal(t.modes.at(-1),false);
});
test('hidden terminal handles bracketed paste and editing without leaking display/history',async()=>{
 const t=terminal();try{let p=t.session.read('Paste: ');t.input.write('\x1b[200~pasted-fixture-value\x1b[201~\r');assert.equal(await p,'pasted-fixture-value');p=t.session.read('Edit: ');t.input.write('wrong\x08!\r');assert.equal(await p,'wron!');p=t.session.read('History: ');t.input.write('\x1b[A\r');assert.equal(await p,'');assert.equal(t.transcript.join(''),'Paste: \nEdit: \nHistory: \n');}finally{t.session.close();}
});
test('cancellation and closing restore terminal state and reject pending reads',async()=>{
 const t=terminal();const pending=t.session.read('Cancel: ');t.input.write('\x03');await assert.rejects(pending,/cancelled/);assert.equal(t.modes.at(-1),false);t.session.close();
 const second=terminal(),p=second.session.read('Close: ');second.session.close();await assert.rejects(p,/cancelled/);
});
test('oversized input is rejected rather than silently truncated',async()=>{const t=terminal();try{const p=t.session.read('Bounded: ');t.input.write('x'.repeat(1025)+'\r');await assert.rejects(p,/too-long/);assert.equal(t.transcript.join(''),'Bounded: \n');}finally{t.session.close();}});
test('key/address errors occur before any passphrase prompt and never include secret text',async()=>{
 const wallet=Wallet.createRandom(),destination=path.resolve(root,'../../work/local-import-invalid-'+randomUUID()),prompts=[];
 const factory=()=>({read:async prompt=>{prompts.push(prompt);return wallet.privateKey;},close(){}});
 try{await runLocalImport(['ethereum-key',Wallet.createRandom().address,destination],factory);assert.fail('Expected rejection');}catch(e){const message=safeImportFailure(e);assert.match(message,/does not match/);assert.equal(message.includes(wallet.privateKey),false);assert.equal(prompts.length,1);}await assert.rejects(()=>fs.stat(destination));
});
test('a short passphrase and mismatch can be retried locally; actual encrypted files and public receipt verify',async()=>{
 const wallet=Wallet.createRandom(),password='Generated disposable local test passphrase 2026!',destination=path.resolve(root,'../../work/local-import-success-'+randomUUID()),answers=[wallet.privateKey,'short',password,'mismatch',password,password],prompts=[];
 await runLocalImport(['ethereum-key',wallet.address,destination],()=>({read:async prompt=>{prompts.push(prompt);return answers.shift();},close(){}}));
 assert.equal(answers.length,0);const receipt=JSON.parse(await fs.readFile(path.join(destination,'PROVISIONING-RECEIPT.json'),'utf8'));assert.equal(receipt.public.evmAddress,wallet.address);assert.equal(receipt.fundsMoved,false);assert.equal(receipt.signingAuthorization,false);assert.notEqual(receipt.receiverPublic.evmAddress,wallet.address);assert.equal(JSON.stringify(receipt).includes(wallet.privateKey),false);assert.equal(prompts.filter(p=>p.includes('private key')).length,1);
 const encrypted=await fs.readFile(path.join(destination,'vault-encrypted.json'),'utf8');assert.equal(encrypted.includes(wallet.privateKey.slice(2)),false);
});
test('safe errors never print arbitrary exception messages or stack traces',()=>{const secret='SECRET-SENTINEL-'+randomUUID();for(const e of [Error(secret),{reason:secret,localStage:secret,kind:secret},null]){const m=safeImportFailure(e);assert.equal(m.includes(secret),false);assert.equal(m.includes('at '),false);}assert.match(safeImportFailure({localStage:'output'}),/folder permissions/);});
