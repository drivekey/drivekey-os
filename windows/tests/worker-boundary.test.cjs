const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(file,input){return spawnSync(process.execPath,[path.join(root,file)],{input,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:2*1024*1024});}
test('signer and protected profile never echo malformed secret-bearing input',()=>{
 for(const file of ['dist/worker.cjs','tools/protected-test-profile.cjs']){
  const p=run(file,'SECRET');assert.equal(p.status,1);const response=JSON.parse(p.stdout);assert.equal(response.ok,false);assert.equal((p.stdout+p.stderr).includes('SECRET'),false);
 }
});
test('secret worker rejects oversized input without returning any part of it',()=>{
 const p=run('dist/worker.cjs','SECRET'.repeat(180000));assert.equal(p.status,2);assert.equal(p.stdout,'');assert.equal(p.stderr.includes('SECRET'),false);
});
test('profile suppresses untrusted library errors but retains fixed local policy errors',()=>{
 const profile=require('../tools/protected-test-profile.cjs');
 assert.equal(profile.safeProfileFailure(new Error('SECRET')), 'Isolated test profile rejected the operation. No secret values were logged.');
 let local;try{profile.directory('../');}catch(error){local=error;}
 assert.equal(profile.safeProfileFailure(local),'Invalid session.');
});
