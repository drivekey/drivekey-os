const {test}=require('node:test'),assert=require('node:assert/strict'),{VersionedTransaction,TransactionMessage,PublicKey}=require('@solana/web3.js'),{BorshInstructionCoder}=require('@coral-xyz/anchor/dist/cjs/coder/borsh/instruction.js'),idl=require('../vendor/jupiter/idl.json'),fixtures=require('./fixtures/lifi-solana.json');
const {inspectLifiSolana,resolveLifiSolana,SOLANA_LIFI}=require('../dist/lifi-solana-inspect.cjs'),coder=new BorshInstructionCoder(idl);
const {fixture,serialize}=require('./helpers/lifi-solana-fixture.cjs');
test('Solana LI.FI decoder resolves actual v0 public-quote tables and bounds both canonical swap directions',()=>{
 for(const i of [0,1]){const f=fixture(i),out=inspectLifiSolana(serialize(f),f.snapshots,f.r);assert.equal(out.review.from,f.r.from);assert.equal(out.review.minimumOutput,f.r.minimumOutput);assert.equal(out.review.protocolFee,f.r.protocolFee);assert.ok(out.review.ammPrograms.length);}
});
test('Solana LI.FI rejects foreign fees, destination accounts, source authorities, token programs and unknown instructions',()=>{
 for(const change of [f=>{f.message.instructions[3].keys[1].pubkey=new PublicKey(SOLANA_LIFI.jupiter);},f=>{f.message.instructions.find(i=>i.programId.toBase58()===SOLANA_LIFI.jupiter).keys[2].pubkey=new PublicKey(SOLANA_LIFI.feeOwner);},f=>{f.message.instructions.at(-1).keys[1].pubkey=new PublicKey(SOLANA_LIFI.feeOwner);},f=>{f.message.instructions[5].data.writeBigUInt64LE(1000000n,4);},f=>{f.message.instructions.find(i=>i.programId.toBase58()===SOLANA_LIFI.jupiter).keys[5].pubkey=new PublicKey(SOLANA_LIFI.feeOwner);},f=>{f.message.instructions.splice(4,0,{programId:new PublicKey(SOLANA_LIFI.feeOwner),keys:[],data:Buffer.from([0])});}]){const f=fixture();change(f);assert.throws(()=>inspectLifiSolana(serialize(f),f.snapshots,f.r));}
});
test('Solana LI.FI rejects lookup substitution, inactive tables, excess fees, hidden route flags and rounding beyond 1%',()=>{
 const f=fixture();assert.throws(()=>inspectLifiSolana(serialize(f),f.snapshots,{...f.r,maximumFee:'1'}));assert.throws(()=>inspectLifiSolana(serialize(f),f.snapshots,{...f.r,epoch:f.r.epoch+1}));assert.throws(()=>inspectLifiSolana(serialize(f),f.snapshots.map(t=>({...t,owner:SOLANA_LIFI.feeOwner})),f.r));
 const inactive=structuredClone(f.snapshots),b=Buffer.from(inactive[0].dataBase64,'base64');b.writeBigUInt64LE(0n,4);inactive[0].dataBase64=b.toString('base64');assert.throws(()=>inspectLifiSolana(serialize(f),inactive,f.r));
 for(const change of [d=>d.platform_fee_bps=1,d=>d.positive_slippage_bps=1,d=>d.in_amount=d.in_amount.addn(1),d=>d.route_plan[0].bps=9999,d=>d.route_plan[0].output_index=5,d=>d.slippage_bps=101]){const x=fixture(),j=x.message.instructions.find(i=>i.programId.toBase58()===SOLANA_LIFI.jupiter),d=coder.decode(j.data);change(d.data);j.data=coder.encode(d.name,d.data);assert.throws(()=>inspectLifiSolana(serialize(x),x.snapshots,x.r));}
 // Actual older quotes rounded their 100-bps minimum down beyond the exact cap.
 // Keep them as negative fixtures, never weaken the limit to accept them.
 for(const old of fixtures.cases){const x=fixture(fixtures.cases.indexOf(old));assert.throws(()=>inspectLifiSolana(old.serialized,old.lookupTables,{...x.r,minimumOutput:(BigInt(x.r.quotedOutput)*9900n/10000n).toString()}));}
});

test('the three observed Jupiter variants require their exact pinned AMM program',()=>{
 const variants={Whirlpool:{a_to_b:true},RaydiumClmm:{},WhirlpoolSwapV2:{a_to_b:true,remaining_accounts_info:null},KipseliV3:{is_base_to_quote:true}};
 for(const [name,args]of Object.entries(variants)){
  const f=fixture(),j=f.message.instructions.find(i=>i.programId.toBase58()===SOLANA_LIFI.jupiter),d=coder.decode(j.data),oldPrograms=new Set(Object.values(SOLANA_LIFI.amms)),key=j.keys.find(k=>oldPrograms.has(k.pubkey.toBase58()));assert.ok(key);
  key.pubkey=new PublicKey(SOLANA_LIFI.amms[name]);d.data.route_plan=[{...d.data.route_plan[0],swap:{[name]:args},bps:10000,input_index:0,output_index:1}];j.data=coder.encode(d.name,d.data);
  assert.deepEqual(inspectLifiSolana(serialize(f),f.snapshots,f.r).review.ammPrograms,[SOLANA_LIFI.amms[name]]);
  key.pubkey=new PublicKey(SOLANA_LIFI.feeOwner);assert.throws(()=>inspectLifiSolana(serialize(f),f.snapshots,f.r),/AMM/);
 }
});
