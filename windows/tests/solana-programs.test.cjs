const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{PublicKey}=require('@solana/web3.js'),{verifySolanaPrograms}=require('../dist/solana-programs.cjs');
function fixture(fail){const program='Gx9rivpS3YR8pBFwMuP6omYqVxunpLvLkNn7ubNyuZZ5',programData='CvTDZ4Wq6znJKM6Rp3ceXCT9mWjSL9WZsAu5vy5FY2u1',owner='BPFLoaderUpgradeab1e11111111111111111111111',bytes=Buffer.alloc(48);bytes.writeUInt32LE(3);bytes.writeBigUInt64LE(123n,4);bytes.write('elf',45);const p=Buffer.alloc(36);p.writeUInt32LE(2);new PublicKey(programData).toBuffer().copy(p,4);const pin={address:program,programData,loader:owner,space:48,deployedSlot:'123',programDataSha256:createHash('sha256').update(bytes).digest('hex')},calls=[],a={endpoints:{solana:'http://127.0.0.1:1'},rpc:async(chain,method,params)=>{calls.push({chain,method,params});assert(['getMultipleAccounts','getAccountInfo'].includes(method));if(method==='getMultipleAccounts')return {value:[{executable:true,owner,data:[p.toString('base64'),'base64']}]};if(fail(calls))throw Error('RPC rejected or malformed response (code -32016).');const slice=params[1].dataSlice;return {context:{slot:123},value:{owner,space:48,data:[bytes.subarray(slice.offset,slice.offset+slice.length).toString('base64'),'base64']}};}};return {pin,a,calls};}
test('Executable verification retries a lagging chunk read with the same minContextSlot and no financial RPC',async()=>{let failed=false;const f=fixture(calls=>{if(!failed&&calls.at(-1).params[1].dataSlice.length===48){failed=true;return true;}return false;});assert.deepEqual(await verifySolanaPrograms(f.a,[f.pin.address],[f.pin]),[f.pin.address]);const chunks=f.calls.filter(c=>c.params[1].dataSlice?.length===48);assert.equal(chunks.length,2);assert.deepEqual(chunks[0],chunks[1]);assert.equal(chunks[0].params[1].minContextSlot,123);assert.equal(failed,true);});
test('Executable verification bounds read retries and stops on a persistent lagging node',async()=>{const f=fixture(()=>true);await assert.rejects(()=>verifySolanaPrograms(f.a,[f.pin.address],[f.pin]),/32016/);assert.equal(f.calls.filter(c=>c.method==='getAccountInfo').length,4);});

test('declared program pins cannot be bypassed by absent, non-executable or native-loader identity', async () => {
  const nativeLoader = 'NativeLoader1111111111111111111111111111111';
  const f = fixture(() => false);
  const tablePin = require('../vendor/jupiter/program-pins.json').programs[0];
  for (const [address, pins] of [[f.pin.address, [f.pin]], [tablePin.address, []]]) {
    for (const identity of [null, undefined, {owner: f.pin.loader}, {executable: false, owner: f.pin.loader},
      {executable: true, owner: nativeLoader}]) {
      const a = {endpoints: f.a.endpoints, rpc: async (_chain, method) => {
        assert.equal(method, 'getMultipleAccounts');
        return {value: [identity]};
      }};
      await assert.rejects(verifySolanaPrograms(a, [address], pins), /Pinned Solana executable is missing or not executable/);
    }
  }
});

test('unpinned ordinary accounts and native built-ins can still be ignored', async () => {
  const nativeLoader = 'NativeLoader1111111111111111111111111111111';
  const f = fixture(() => false);
  const a = {endpoints: f.a.endpoints, rpc: async (_chain, method) => {
    assert.equal(method, 'getMultipleAccounts');
    return {value: [null, {executable: false}, {executable: true, owner: nativeLoader}]};
  }};
  assert.deepEqual(await verifySolanaPrograms(a, ['missing-account', 'data-account', 'native-builtin']), []);
});
