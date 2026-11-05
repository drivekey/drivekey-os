const {test}=require('node:test'),assert=require('node:assert/strict'),{AbiCoder,Wallet}=require('ethers');
const {LifiQuotes,UniswapQuotes,inspectV3Router,UNIVERSAL_ROUTER_ABI}=require('../dist/providers.cjs');
const {CHAINS}=require('../dist/payment.cjs');
test('LI.FI uses the pinned official SDK and rejects changed route semantics; provider DONE/PARTIAL is never settled',async()=>{
 const original=global.fetch,from=Wallet.createRandom().address,to=Wallet.createRandom().address;let changed=false;
 global.fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('/tokens'))return Response.json({tokens:{1:[{symbol:'ETH',coinKey:'ETH',address:'0x'+'0'.repeat(40),decimals:18},{symbol:'USDC',coinKey:'USDC',address:CHAINS.ethereum.usdc,decimals:6}]}});if(u.pathname.endsWith('/status'))return Response.json({status:'DONE',substatus:'PARTIAL'});return Response.json({tool:'fixture',action:{fromChainId:1,toChainId:1,fromAddress:from,toAddress:changed?Wallet.createRandom().address:to,fromAmount:'100',fromToken:{address:'0x'+'0'.repeat(40),decimals:18},toToken:{address:CHAINS.ethereum.usdc,decimals:6}},estimate:{toAmountMin:'99',toAmount:'100',approvalAddress:Wallet.createRandom().address}});};
 try{const p=new LifiQuotes(),input={fromChain:'ethereum',toChain:'ethereum',fromAsset:'ETH',toAsset:'USDC',amount:'100',fromAddress:from,toAddress:to,slippageBps:100};assert.equal((await p.quote(input)).executionEnabled,false);changed=true;await assert.rejects(()=>p.quote(input),/differs/);assert.equal((await p.status({txHash:'0x'+'a'.repeat(64),fromChain:'ethereum',toChain:'ethereum',bridge:'fixture'})).settled,false);}finally{global.fetch=original;}
});
test('router decoder rejects unknown commands, allow-revert, unexpected recipient, permits, and excessive input',()=>{
 const expected={recipient:Wallet.createRandom().address,amount:'100',minimumOutput:'90',tokenIn:CHAINS.ethereum.usdc,tokenOut:Wallet.createRandom().address,deadline:1900000000};
 const path=expected.tokenIn.toLowerCase()+'0001f4'+expected.tokenOut.slice(2).toLowerCase(),input=AbiCoder.defaultAbiCoder().encode(['address','uint256','uint256','bytes','bool'],[expected.recipient,100,90,path,true]);
 const encode=(commands='0x00',inputs=[input])=>UNIVERSAL_ROUTER_ABI.encodeFunctionData('execute',[commands,inputs,expected.deadline]);assert.equal(inspectV3Router(encode(),expected).amount,'100');
 for(const c of ['0x80','0x0a','0x0200','0x05'])assert.throws(()=>inspectV3Router(encode(c),expected));assert.throws(()=>inspectV3Router(encode(),{...expected,recipient:Wallet.createRandom().address}));assert.throws(()=>inspectV3Router(encode(),{...expected,amount:'99'}));assert.throws(()=>inspectV3Router(encode(),{...expected,deadline:expected.deadline+1}));
});
test('Uniswap API quote validates Ethereum-only request and rejects altered output token',async()=>{
 const from=Wallet.createRandom().address,transport=async(_url,init)=>{const p=JSON.parse(init.body);assert.equal(p.tokenInChainId,1);return {routing:'CLASSIC',quote:{input:{amount:p.amount,token:p.tokenIn},output:{token:Wallet.createRandom().address},swapper:from}};};
 await assert.rejects(()=>new UniswapQuotes('fixture-key',transport).quote({from,tokenIn:'ETH',tokenOut:'USDC',amount:'100',slippageBps:50}),/differs/);assert.throws(()=>new UniswapQuotes(''));
});
