// Explicit local fork only. Sends signed transactions solely to an in-process EVM.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomBytes}=require('node:crypto'),ganache=require('ganache');
const {OnlineAdapter}=require('../dist/adapter.cjs'),{UniswapAdapter}=require('../dist/uniswap.cjs'),{SettlementVerifier}=require('../dist/checkout-verifier.cjs'),{CheckoutService}=require('../dist/checkout-service.cjs'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),password=randomBytes(48).toString('base64');
const evidence={checkedAt:new Date().toISOString(),evidenceLevel:'local-mainnet-fork',remoteEndpoint:'https://eth.rpc.blxrbdn.com',mainnetSubmissions:0,cases:[]};
function worker(j){const p=spawnSync(process.execPath,[path.join(root,'dist/worker.cjs')],{input:JSON.stringify(j),encoding:'utf8',windowsHide:true});const r=JSON.parse(p.stdout);if(!r.ok)throw Error('Application worker rejected fork operation.');return r.result;}
async function run(){let evm;try{
 const {fingerprint}=await import('../tools/fingerprint.mjs');evidence.source=await fingerprint(root);evidence.binaryHashes={};for(const name of ['worker.cjs','adapter.cjs','uniswap.cjs','checkout-verifier.cjs','checkout-service.cjs'])evidence.binaryHashes[name]=require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'dist',name))).digest('hex');
 const remote=new OnlineAdapter({ethereum:evidence.remoteEndpoint});await remote.identity('ethereum');const block=await remote.rpc('ethereum','eth_getBlockByNumber',['latest',false]);evidence.forkBlock=block.number;evidence.forkBlockHash=block.hash;
 const provider={request:({method,params})=>remote.rpc('ethereum',method,params||[])};
 evm=ganache.provider({logging:{quiet:true},chain:{chainId:1,hardfork:'shanghai'},fork:{provider,blockNumber:Number(BigInt(block.number))},wallet:{totalAccounts:0}});
 await evm.request({method:'eth_chainId',params:[]});
 const vault=worker({action:'create',password});await evm.request({method:'evm_setAccountBalance',params:[vault.public.evmAddress,'0xde0b6b3a7640000']});
 const adapter=new OnlineAdapter({ethereum:'http://localhost:8545'},async(_u,init)=>{const j=JSON.parse(init.body);return {jsonrpc:'2.0',id:j.id,result:await evm.request({method:j.method,params:j.params})};}),swaps=new UniswapAdapter(adapter);
 async function execute(id,input){const request=await swaps.prepare(input,vault.public),review=worker({action:'review',vault,request}),response=worker({action:'sign',vault,password,request,fingerprint:request.fingerprint});await swaps.preflight(request);await swaps.broadcast(request,response);const settlement=await swaps.reconcile(request,response);if(settlement.state!=='confirmed')throw Error('Fork operation did not settle.');
  const recovered=worker({action:'verify-saved',vault,request,response});if(recovered.response.transactionHash!==response.transactionHash)throw Error('Fork recovery mismatch.');evidence.cases.push({id,request,review,transactionHash:response.transactionHash,settlement,recovered:true,evidenceLevel:'local-mainnet-fork'});}
 await execute('uniswap-eth-usdc',{action:'swap',tokenIn:'ETH',amount:'100000000000000',recipient:vault.public.evmAddress,slippageBps:100,poolFee:500});
 await execute('uniswap-usdc-approval',{action:'approve',tokenIn:'USDC',amount:'100000',recipient:vault.public.evmAddress,slippageBps:0,poolFee:500});
 await execute('uniswap-usdc-eth',{action:'swap',tokenIn:'USDC',amount:'100000',recipient:vault.public.evmAddress,slippageBps:100,poolFee:500});
 const db=new PGlite();try{
  await db.exec(fs.readFileSync(path.join(root,'merchant/schema.sql'),'utf8'));const verifier=new SettlementVerifier(adapter),checkout=new CheckoutService(db,(invoice,hash)=>verifier.verify(invoice,hash));
  const recipients=[worker({action:'create',password}),worker({action:'create',password})];await checkout.provision('ethereum',recipients.map(v=>v.public.evmAddress));
  for(const [asset,amount]of [['ETH','10000000000'],['USDC','10000']]){
   const invoice=await checkout.create({chain:'ethereum',asset,amount,expiresInSeconds:600},'fork-invoice-'+asset+'-00001');
   const request=await adapter.prepare({chain:'ethereum',asset,amount,recipient:invoice.address},vault.public);await adapter.preflight(request);
   const response=worker({action:'sign',vault,password,request,fingerprint:request.fingerprint});await adapter.broadcast(request,response);const settlement=await adapter.reconcile(request,response);if(settlement.state!=='confirmed')throw Error('Fork payment did not settle.');
   const merchantReceipt=await checkout.observe(invoice.public_token,response.transactionHash);if(merchantReceipt.status!=='paid')throw Error('Fork merchant invoice not paid: '+merchantReceipt.status);
   const recovered=worker({action:'verify-saved',vault,request,response});if(recovered.response.transactionHash!==response.transactionHash)throw Error('Fork payment recovery mismatch.');
   evidence.cases.push({id:'payment-and-merchant-'+asset.toLowerCase(),invoice,request,transactionHash:response.transactionHash,settlement,merchantReceipt,recovered:true,evidenceLevel:'local-mainnet-fork'});
  }
 }finally{await db.close();}
 evidence.passed=true;
 }catch(e){evidence.passed=false;evidence.error=e.message;process.exitCode=1;}finally{if(evm)await evm.disconnect();fs.mkdirSync(path.join(root,'verification'),{recursive:true});fs.writeFileSync(path.join(root,'verification/UNISWAP-FORK.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:evidence.passed,error:evidence.error,cases:evidence.cases.map(c=>({id:c.id,state:c.settlement.state,hash:c.transactionHash}))}));}}
run();
