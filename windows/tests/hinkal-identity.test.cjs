const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
function call(file,job){const p=spawnSync(process.execPath,['--no-addons','--require','./tests/offline-network-deny.cjs','dist/'+file],{input:JSON.stringify(job),encoding:'utf8',windowsHide:true});return JSON.parse(p.stdout);}
test('Hinkal view derivation is deterministic and chain-scoped without exporting the master signature or spending key',()=>{
 const password=randomBytes(48).toString('base64'),vault=call('worker.cjs',{action:'create',password}).result;
 for(const chain of ['ethereum','solana']){const job={action:'derive-test-hinkal-view',testOnly:true,chain,expectedAddress:chain==='ethereum'?vault.public.evmAddress:vault.public.solanaAddress,password,vault};
  const a=call('hinkal-login.cjs',job),b=call('hinkal-login.cjs',job);assert.equal(a.ok,true);assert.deepEqual(a.result,b.result);assert.equal(a.result.signature,undefined);assert.equal(a.result.privateKey,undefined);assert.equal(a.result.readOnly,true);assert.deepEqual(Object.keys(a.result).sort(),['chain','address','nullifyingKey','spendingPublicKey','readOnly','testOnly'].sort());assert.equal(a.result.spendingPublicKey.length,2);
  for(const change of [{message:'arbitrary'},{transaction:{value:'1'}},{testOnly:false},{expectedAddress:'wrong wallet'},{action:'derive-test-hinkal-identity'}])assert.equal(call('hinkal-login.cjs',{...job,...change}).ok,false);
 }
});
