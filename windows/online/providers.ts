// Public quote and route-status integration. No provider is given signing authority.
import { createClient, getQuote, getStatus, getChains, getTokens, ChainType } from '@lifi/sdk';
import { z } from 'zod';
import { getAddress, Interface, AbiCoder } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { boundedJSON } from './adapter';
import { CHAINS } from '../engine/core/payment-intent';
export const LIFI_SOLANA=1151111081099710;
const chainId={ethereum:1,solana:LIFI_SOLANA};
const address=(network:'ethereum'|'solana',value:string)=>network==='ethereum'?getAddress(value):new PublicKey(value).toBase58();
const sameToken=(chain:'ethereum'|'solana',a:string,b:string)=>address(chain,a)===address(chain,b);
export class LifiQuotes {
 readonly client=createClient({integrator:'DriveKey',preloadChains:false,disableVersionCheck:true,providers:[],requestInterceptor:r=>({...r,redirect:'error',signal:AbortSignal.timeout(20000)})});
 async capabilities(){const chains=await getChains(this.client,{chainTypes:[ChainType.EVM,ChainType.SVM]});return chains.filter(c=>c.id===1||c.id===LIFI_SOLANA).map(c=>({id:c.id,name:c.name,chainType:c.chainType}));}
 async quote(input:unknown){return this.readRoute(input,false);}
 async discoverRelay(input:unknown){for(let attempt=0;;attempt++){try{return await this.readRoute(input,true);}catch(error){if(attempt>=2||!(error instanceof Error)||!(/status code 422/.test(error.message)&&/None of the available routes could successfully generate a tx/.test(error.message)||/status code 429/.test(error.message)))throw error;await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));}}}
 private async readRoute(input:unknown,discoveryOnly:boolean){
  const p=z.object({fromChain:z.enum(['ethereum','solana']),toChain:z.enum(['ethereum','solana']),fromAsset:z.enum(['ETH','SOL','USDC']),toAsset:z.enum(['ETH','SOL','USDC']),amount:z.string().regex(/^[1-9][0-9]*$/).max(38),fromAddress:z.string().max(64),toAddress:z.string().max(64),slippageBps:z.number().int().min(0).max(100),exchange:z.enum(['sushiswap','paraswap','jupiter','1inch']).optional(),bridge:z.enum(['mayan','mayanMCTP','mayanFastMCTP','cctp','relaydepository']).optional()}).strict().parse(input);
  const from=CHAINS[p.fromChain],to=CHAINS[p.toChain];if((p.fromAsset!==from.native&&p.fromAsset!=='USDC')||(p.toAsset!==to.native&&p.toAsset!=='USDC'))throw Error('Asset and chain mismatch.');
  if(discoveryOnly&&(p.bridge!=='relaydepository'||p.fromChain===p.toChain))throw Error('Discovery-only data is restricted to a new independently verified Relay bridge intent.');
  const catalog=await getTokens(this.client,{chains:[chainId[p.fromChain],chainId[p.toChain]],chainTypes:[ChainType.EVM,ChainType.SVM]});
  const resolve=(chain:'ethereum'|'solana',asset:string)=>{const entries=(catalog.tokens as any)[chainId[chain]];if(!Array.isArray(entries))throw Error('Missing token catalog.');const expected=asset==='USDC'?CHAINS[chain].usdc:null;
   const token=entries.find((t:any)=>t.symbol===asset&&t.coinKey===asset&&(!expected||sameToken(chain,t.address,expected)));if(!token||token.decimals!==(asset==='USDC'?6:CHAINS[chain].decimals))throw Error('Canonical provider token is unavailable.');return token.address;};
  const fromAddress=address(p.fromChain,p.fromAddress),toAddress=address(p.toChain,p.toAddress),fromToken=resolve(p.fromChain,p.fromAsset),toToken=resolve(p.toChain,p.toAsset);
  const quote=await getQuote(this.client,{fromChain:chainId[p.fromChain],toChain:chainId[p.toChain],fromToken,toToken,fromAmount:p.amount,fromAddress,toAddress,slippage:Math.max(0,p.slippageBps-1)/10000,...p.exchange?{allowExchanges:[p.exchange]}:{},...p.bridge?{allowBridges:[p.bridge]}:{}});
  const a=quote.action,e=quote.estimate;if(p.exchange&&p.fromChain===p.toChain&&quote.tool!==p.exchange)throw Error('Provider changed the restricted exchange.');if(p.bridge&&p.fromChain!==p.toChain&&quote.tool!==p.bridge)throw Error('Provider changed the restricted bridge.');
  if(!a||a.fromChainId!==chainId[p.fromChain]||a.toChainId!==chainId[p.toChain]||address(p.fromChain,a.fromAddress!)!==fromAddress||address(p.toChain,a.toAddress!)!==toAddress||a.fromAmount!==p.amount||!sameToken(p.fromChain,a.fromToken.address,fromToken)||!sameToken(p.toChain,a.toToken.address,toToken)||a.fromToken.decimals!==(p.fromAsset==='USDC'?6:from.decimals)||a.toToken.decimals!==(p.toAsset==='USDC'?6:to.decimals)||!e||!/^\d+$/.test(e.toAmountMin)||BigInt(e.toAmountMin)<=0n||!/^\d+$/.test(e.toAmount)||BigInt(e.toAmountMin)>BigInt(e.toAmount))throw Error('Provider quote differs from requested route.');
  if(!discoveryOnly&&BigInt(e.toAmountMin)*10000n<BigInt(e.toAmount)*BigInt(10000-p.slippageBps))throw Error('Provider minimum output exceeds permitted slippage.');
  return {provider:'lifi',quote,discoveryOnly,signingDisabledForDiscovery:discoveryOnly,review:{source:p.fromChain,destination:p.toChain,fromAddress,toAddress,fromToken,toToken,amount:p.amount,minimumOutput:e.toAmountMin,estimatedOutput:e.toAmount,approvalAddress:e.approvalAddress,tool:quote.tool},executionEnabled:false,reason:discoveryOnly?'Route discovery only. Do not sign this provider payload. A new independently signed Relay order and a new fully decoded intent are required.':'Independent bridge and router decoding, reviewed approvals and destination settlement qualification remain incomplete.'};
 }
 async status(input:unknown){const p=z.object({txHash:z.string().min(32).max(100),fromChain:z.enum(['ethereum','solana']),toChain:z.enum(['ethereum','solana']),bridge:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)}).strict().parse(input);const s=await getStatus(this.client,{txHash:p.txHash,fromChain:chainId[p.fromChain],toChain:chainId[p.toChain],bridge:p.bridge});
  if(!['NOT_FOUND','PENDING','DONE','FAILED','INVALID'].includes(s.status))throw Error('Unknown route status.');
  return {providerStatus:s.status,substatus:'substatus'in s?s.substatus:null,settled:false,reason:'Destination asset, recipient, amount and finality require independent chain verification.'};}
}
export class UniswapQuotes {
 constructor(readonly apiKey:string,readonly transport=boundedJSON){if(!apiKey||apiKey.length>1024)throw Error('Uniswap API key required in local online configuration.');}
 async quote(input:unknown){const p=z.object({from:z.string(),tokenIn:z.enum(['ETH','USDC']),tokenOut:z.enum(['ETH','USDC']),amount:z.string().regex(/^[1-9][0-9]*$/).max(38),slippageBps:z.number().int().min(0).max(100)}).strict().parse(input);if(p.tokenIn===p.tokenOut)throw Error('Choose different assets.');const from=getAddress(p.from),token=(a:string)=>a==='ETH'?'0x0000000000000000000000000000000000000000':CHAINS.ethereum.usdc;
  const result=await this.transport('https://trade-api.gateway.uniswap.org/v1/quote',{method:'POST',headers:{'content-type':'application/json','x-api-key':this.apiKey},body:JSON.stringify({type:'EXACT_INPUT',amount:p.amount,tokenInChainId:1,tokenOutChainId:1,tokenIn:token(p.tokenIn),tokenOut:token(p.tokenOut),swapper:from,protocols:['V3'],slippageTolerance:p.slippageBps/100})});
  if(result?.routing!=='CLASSIC'||!result.quote||result.quote.input?.amount!==p.amount||getAddress(result.quote.input?.token)!==getAddress(token(p.tokenIn))||getAddress(result.quote.output?.token)!==getAddress(token(p.tokenOut))||getAddress(result.quote.swapper)!==from)throw Error('Uniswap quote differs from requested swap.');
  return {provider:'uniswap',quote:result,executionEnabled:false,reason:'API Permit2 and Universal Router signing is not yet qualified. Solana is unsupported.'};
 }
}
// Decoder candidate, deliberately not connected to signing. Reject unknown commands and allow-revert bits.
export const UNIVERSAL_ROUTER_ABI=new Interface(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
export function inspectV3Router(data:string,expected:{recipient:string;amount:string;minimumOutput:string;tokenIn:string;tokenOut:string;deadline:number}){
 const call=UNIVERSAL_ROUTER_ABI.parseTransaction({data});if(!call||call.name!=='execute')throw Error('Unknown router entry point.');
 const [commands,inputs,deadline]=call.args;if(commands!=='0x00'||inputs.length!==1||deadline!==BigInt(expected.deadline))throw Error('Unreviewed router commands or deadline.');
 const [recipient,amount,minimum,path,payerIsUser]=AbiCoder.defaultAbiCoder().decode(['address','uint256','uint256','bytes','bool'],inputs[0]);
 if(getAddress(recipient)!==getAddress(expected.recipient)||amount!==BigInt(expected.amount)||minimum!==BigInt(expected.minimumOutput)||minimum<=0n||payerIsUser!==true||path.length!==88||getAddress(path.slice(0,42))!==getAddress(expected.tokenIn)||getAddress('0x'+path.slice(-40))!==getAddress(expected.tokenOut)||!['0001f4','000bb8','002710'].includes(path.slice(42,48)))throw Error('Unreviewed router payment or path.');
 return {recipient,amount:amount.toString(),minimumOutput:minimum.toString(),deadline:deadline.toString(),permit:'None in this restricted decoder; separate reviewed Permit2 support is required.'};
}
