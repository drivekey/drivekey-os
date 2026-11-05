// Public read-only deployment provenance and independent runtime/facet snapshots.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{Interface,getAddress,keccak256}=require('ethers');
const {OnlineAdapter}=require('../dist/adapter.cjs'),root=path.resolve(__dirname,'..'),output=path.resolve(root,'../../outputs');
async function json(url){try{const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'DriveKey-acceptance'}});if(!r.ok)throw Error('Public source HTTP '+r.status);return await r.json();}catch(e){throw Error('Public provenance fetch failed at '+url+': '+e.message+' '+(e.cause?.code||''));}}
(async()=>{
 const commit=(await json('https://api.github.com/repos/lifinance/contracts/commits/main')).sha,base='https://raw.githubusercontent.com/lifinance/contracts/'+commit,deploy=await json(base+'/deployments/mainnet.json'),whitelist=await json(base+'/config/whitelist.json');
 const permitted=JSON.stringify(whitelist).toLowerCase();if(!permitted.includes('0x111111125421ca6dc452d289314280a0f8842a65')||!permitted.includes('0x07ed2379'))throw Error('Official LI.FI router whitelist missing.');
 const addresses={diamond:deploy.LiFiDiamond,facet:deploy.GenericSwapFacetV3,feeForwarder:deploy.FeeForwarder,oneInch:'0x111111125421cA6dc452d289314280a0f8842A65',executor:'0x111116058B9828cDCdD810c502B925c14f34ca11'},loupe=new Interface(['function facetAddress(bytes4) view returns(address)']),selectors=['0x736eac0b','0x2c57e884'];
 const observations=await Promise.all(['https://eth.rpc.blxrbdn.com','https://0xrpc.io/eth'].map(async endpoint=>{
  const a=new OnlineAdapter({ethereum:endpoint});await a.identity('ethereum');const block=await a.rpc('ethereum','eth_getBlockByNumber',['latest',false]),pins={};
  for(const [name,address]of Object.entries(addresses)){const code=await a.rpc('ethereum','eth_getCode',[address,block.number]);if(code==='0x')throw Error('Missing deployed code.');pins[name]={address:getAddress(address.toLowerCase()),codeHash:keccak256(code)};}
  for(const selector of selectors){const facet=loupe.decodeFunctionResult('facetAddress',await a.rpc('ethereum','eth_call',[{to:addresses.diamond,data:loupe.encodeFunctionData('facetAddress',[selector])},block.number]))[0];if(facet!==getAddress(addresses.facet))throw Error('Published facet differs from live selector.');}
  return {endpoint,block:block.number,blockHash:block.hash,pins,selectors};
 }));
 if(JSON.stringify(observations[0].pins)!==JSON.stringify(observations[1].pins))throw Error('Independent deployment disagreement.');
 const data={checkedAt:new Date().toISOString(),mainnetSubmissions:0,officialRepository:'https://github.com/lifinance/contracts',commit,sourceHashes:{deployments:createHash('sha256').update(JSON.stringify(deploy)).digest('hex'),whitelist:createHash('sha256').update(JSON.stringify(whitelist)).digest('hex')},observations};
 fs.writeFileSync(path.join(output,'LIFI-ETHEREUM-PINS.json'),JSON.stringify(data,null,2));console.log(JSON.stringify(observations[0].pins));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
