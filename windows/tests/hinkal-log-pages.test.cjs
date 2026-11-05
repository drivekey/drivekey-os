const {test}=require('node:test'),assert=require('node:assert/strict');
const {readHinkalCommitments,HINKAL_LOG_PAGE_BLOCKS}=require('../dist/hinkal-local-merkle-adapter.cjs');
const {HINKAL_ABI,HINKAL_PIN}=require('../dist/hinkal.cjs');
const event=(block,index,commitment,extra={})=>({address:HINKAL_PIN.ethereumContract,blockNumber:'0x'+BigInt(block).toString(16),logIndex:'0x0',removed:false,...HINKAL_ABI.encodeEventLog(HINKAL_ABI.getEvent('NewCommitment'),[commitment,index,'0x']),...extra});
test('Hinkal commitment reads use contiguous pages of at most fifty blocks and preserve every leaf',async()=>{
 const calls=[],logs=[event(1,100,11),event(50,101,12),event(51,102,13),event(101,103,14)];
 const a={rpc:async(chain,method,[filter])=>{assert.equal(chain,'ethereum');assert.equal(method,'eth_getLogs');assert.equal(filter.address,HINKAL_PIN.ethereumContract);assert.deepEqual(filter.topics,[HINKAL_ABI.getEvent('NewCommitment').topicHash]);const from=BigInt(filter.fromBlock),to=BigInt(filter.toBlock);assert.ok(to-from+1n<=50n);calls.push([from,to]);return logs.filter(l=>BigInt(l.blockNumber)>=from&&BigInt(l.blockNumber)<=to).reverse();}};
 const leaves=await readHinkalCommitments(a,1n,101n);assert.equal(HINKAL_LOG_PAGE_BLOCKS,50n);assert.deepEqual(calls,[[1n,50n],[51n,100n],[101n,101n]]);assert.deepEqual(leaves,[{index:'100',commitment:'11'},{index:'101',commitment:'12'},{index:'102',commitment:'13'},{index:'103',commitment:'14'}]);assert.deepEqual(await readHinkalCommitments(a,2n,1n),[]);
});
test('Hinkal paged reads reject foreign, removed, out-of-page, malformed and oversized log results',async()=>{
 for(const response of [[event(1,100,11,{removed:true})],[event(1,100,11,{address:'0x0000000000000000000000000000000000000001'})],[event(51,100,11)],{},Array(1025).fill(event(1,100,11))])await assert.rejects(()=>readHinkalCommitments({rpc:async()=>response},1n,50n));
 await assert.rejects(()=>readHinkalCommitments({rpc:async()=>[]},-1n,1n));
});
