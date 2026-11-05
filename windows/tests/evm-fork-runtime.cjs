const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
// Local fixture infrastructure only. Anvil has zero test accounts and receives
// no vault material; all signed traffic stays on its loopback RPC.
async function startFork(remote,block){
 const dir=path.resolve(__dirname,'../../../work/foundry-v1.7.1'),exe=path.join(dir,'package/bin/anvil.exe'),provenance=JSON.parse(fs.readFileSync(path.join(dir,'PROVENANCE.json'),'utf8'));
 if(!provenance.binaryHashes?.['anvil.exe']||createHash('sha256').update(fs.readFileSync(exe)).digest('hex')!==provenance.binaryHashes['anvil.exe'])throw Error('Local Foundry binary checksum missing or changed.');
 // Resolve upstream data before opening local listeners, so an RPC failure
 // cannot strand a loopback proxy during test startup.
 const publicGasPrice=BigInt(await remote.rpc('ethereum','eth_gasPrice',[])),syntheticFees=process.argv.includes('--synthetic-fees');
 const proxy=http.createServer(async(req,res)=>{let bytes=0,data='';for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024){res.writeHead(413).end();return;}data+=chunk;}try{const j=JSON.parse(data);if(!/^(eth_(?:get|call|chainId|blockNumber)|net_version|web3_clientVersion)/.test(j.method))throw Error('Remote mutations forbidden.');const result=await remote.rpc('ethereum',j.method,j.params||[]);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:j.id,result}));}catch{res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'Read-only fork upstream failed.'}}));}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 // Explicit local-only fixture mode. Live policy and public gas observations
 // remain unchanged; this controls only the synthetic Anvil block environment.
 const gasPrice=syntheticFees?100000000n:publicGasPrice;
 const child=spawn(exe,['--host','127.0.0.1','--port',String(port),'--chain-id','1','--hardfork','osaka','--gas-price',gasPrice.toString(),...syntheticFees?['--block-base-fee-per-gas',gasPrice.toString()]:[],'--disable-min-priority-fee','--accounts','0','--no-storage-caching','--fork-url','http://127.0.0.1:'+proxy.address().port,'--fork-block-number',String(BigInt(block)),'--silent'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr='',exited=false;child.stderr.on('data',b=>{if(stderr.length<4000)stderr+=b.toString();});child.on('exit',()=>exited=true);const endpoint='http://127.0.0.1:'+port;
 async function request({method,params=[]}){const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await response.json();if(j.error){const e=Error(j.error.message);e.data=j.error.data;throw e;}return j.result;}
 try{let ready=false;for(let i=0;i<100;i++){if(exited)throw Error('Local Foundry exited: '+stderr);try{await request({method:'eth_chainId'});ready=true;break;}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Local Foundry startup timeout.');}
 catch(e){child.kill();await new Promise(resolve=>proxy.close(resolve));throw e;}
 const localGasPrice=BigInt(await request({method:'eth_gasPrice'})),pending=await request({method:'eth_getBlockByNumber',params:['pending',false]});
 if(syntheticFees&&(localGasPrice!==gasPrice||BigInt(pending.baseFeePerGas)<=0n||BigInt(pending.baseFeePerGas)>gasPrice)){child.kill();await new Promise(resolve=>proxy.close(resolve));throw Error('Synthetic Anvil fee configuration was not honored.');}
 return {endpoint,engine:{name:'anvil',tag:provenance.tag,hardfork:'osaka',gasPriceWei:gasPrice.toString(),gasPriceSource:syntheticFees?'explicit synthetic local-fork fixture; not a live fee estimate':'public fork RPC snapshot; EIP1559 estimator without default 1-gwei tip floor',syntheticFees,publicMarketGasPriceWei:publicGasPrice.toString(),localReportedGasPriceWei:localGasPrice.toString(),localPendingBaseFeeWei:BigInt(pending.baseFeePerGas).toString(),binarySha256:provenance.binaryHashes['anvil.exe'],mainnetSubmissions:0},request,disconnect:async()=>{child.kill();await new Promise(resolve=>proxy.close(resolve));}};
}
module.exports={startFork};
