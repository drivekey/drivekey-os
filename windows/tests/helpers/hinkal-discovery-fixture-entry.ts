// Test-only entry: real SDK quote/fee helpers with a deterministic HTTP fixture.
// No network, wallet, signing key or blockchain submission is available here.
import {hinkalDiscover} from '../../online/hinkal';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
const {httpClient}=require('../../node_modules/@hinkal/common/common/src/data-structures/http/HttpClient.cjs'),
 {tokenCallsCachedHelper}=require('../../node_modules/@hinkal/common/common/src/API/TokenCallsCachedHelper.cjs'),
 {networkRegistry}=require('../../node_modules/@hinkal/common/common/src/constants/chains.constants.cjs'),
 {getSwapperAccountPublicKeyFromSalt}=require('../../node_modules/@hinkal/common/common/src/functions/pre-transaction/solana.cjs');
for(const name of ['log','error','warn','debug','info'] as const)console[name]=()=>{};
const plain=(x:any)=>JSON.parse(JSON.stringify(x,(_k,v)=>typeof v==='bigint'?v.toString():v));
export async function run(cases:any[]){
 const rows=[];
 for(const item of cases){
  const calls:any[]=[];tokenCallsCachedHelper.tokenCache.clear();tokenCallsCachedHelper.requestCache.clear();
  httpClient.setHttpClient({post:async(url:string,body:any)=>{
   const endpoint=new URL(url).pathname;calls.push({endpoint,body:plain(body)});
   if(endpoint.endsWith('/get-tokens-info'))return item.mode==='missing-token'?[]:body.tokenAddresses.map((address:string)=>({chainId:body.chainId,erc20TokenAddress:address,decimals:address==='0x0000000000000000000000000000000000000000'?18:address==='11111111111111111111111111111111'?9:6,symbol:'FIXTURE',name:'Fixture token'}));
   if(endpoint.endsWith('/LifiBridgeData')){if(item.mode==='quote-error')throw Error('Fixture provider unavailable');return{lifiResponse:{estimate:{toAmount:'123456'},transactionRequest:{data:'0x1234',value:body.fromToken==='0x0000000000000000000000000000000000000000'?body.fromAmount:'0'}}};}
   if(endpoint.endsWith('/OkxSwapData')){if(item.mode==='quote-error')throw Error('Fixture provider unavailable');return{status:'success',okxResponse:{code:'0',data:{routerResult:{toTokenAmount:'123456'}}}};}
   if(endpoint.includes('/gas-estimation/'))return{priceOfTransactionInUSD:0.01,priceOfTransactionInToken:0.000007};
   throw Error('Unexpected HTTP request: '+endpoint);
  },get:async()=>{throw Error('Unexpected GET request');}});
  try{
   const result=plain(await hinkalDiscover(item.input));let solanaSwapperBindingVerified=false;
   if(result.result.okxDataValue){
    const quote=JSON.parse(result.result.okxDataValue),call=calls.find(c=>c.endpoint.endsWith('/OkxSwapData')),salt=BigInt(quote.swapperAccountSalt),config=networkRegistry[501].contractData;
    assert.equal(call.body.quote.userWalletAddress,getSwapperAccountPublicKeyFromSalt(new PublicKey(config.hinkalAddress),new PublicKey(config.originalDeployer),salt).toBase58());
    quote.swapperAccountSalt='<fresh-public-salt>';call.body.quote.userWalletAddress='<derived-swapper-account>';result.result.okxDataValue=JSON.stringify(quote);solanaSwapperBindingVerified=true;
   }
   rows.push({id:item.id,ok:true,result,calls,solanaSwapperBindingVerified});
  }catch(error){const call=calls.find(c=>c.endpoint.endsWith('/OkxSwapData'));if(call){new PublicKey(call.body.quote.userWalletAddress);call.body.quote.userWalletAddress='<derived-swapper-account>';}rows.push({id:item.id,ok:false,error:error instanceof Error?error.message:'Rejected',calls});}
 }
 return rows;
}
if(require.main===module){let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{try{process.stdout.write(JSON.stringify(await run(JSON.parse(input))),()=>process.exit(0));}catch{process.exit(1);}});}
