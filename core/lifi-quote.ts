import 'server-only';
import {z} from 'zod';
import {formatUnits,parseUnits} from 'ethers';
import {multiPublicSchema} from './multi-protocol';
import {LIFI_ASSETS,type LifiAssetKey,type LifiQuote} from './lifi-assets';
const assetKey=z.custom<LifiAssetKey>(v=>typeof v==='string'&&Object.hasOwn(LIFI_ASSETS,v));
export const lifiQuoteInput=z.object({wallet:multiPublicSchema,from:assetKey,to:assetKey,amount:z.string().max(60).regex(/^(0|[1-9]\d*)(\.\d+)?$/),slippageBps:z.union([z.literal(25),z.literal(50),z.literal(100)])}).strict();
const integer=z.string().max(78).regex(/^(0|[1-9]\d*)$/);
const token=z.object({address:z.string().min(1).max(64),chainId:z.number().int().positive(),decimals:z.number().int().min(0).max(36),symbol:z.string().min(1).max(50)});
const cost=z.object({name:z.string().max(150).optional(),type:z.string().max(50).optional(),amount:integer,token,included:z.boolean().optional()});
const quoteSchema=z.object({id:z.string().min(1).max(200),tool:z.string().min(1).max(100),toolDetails:z.object({name:z.string().min(1).max(100)}),action:z.object({fromChainId:z.number(),toChainId:z.number(),fromToken:token,toToken:token,fromAmount:integer,fromAddress:z.string(),toAddress:z.string(),slippage:z.number()}),estimate:z.object({fromAmount:integer,toAmount:integer,toAmountMin:integer,executionDuration:z.number().finite().min(0).max(604800),feeCosts:z.array(cost).max(50),gasCosts:z.array(cost).max(50)})});
const equal=(a:string,b:string,chain:number)=>chain===1151111081099710?a===b:a.toLowerCase()===b.toLowerCase();
async function readBounded(response:Response){
 const reader=response.body?.getReader();if(!reader)throw Error('LI.FI returned an empty response.');
 let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw Error('LI.FI response exceeded the size limit.');}text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());
}
export async function getLifiQuote(input:unknown,fetcher:typeof fetch=fetch):Promise<LifiQuote>{
 const a=lifiQuoteInput.parse(input),from=LIFI_ASSETS[a.from],to=LIFI_ASSETS[a.to];
 if(a.from===a.to)throw Error('Choose two different assets.');
 let amount:bigint;try{amount=parseUnits(a.amount,from.decimals);}catch{throw Error('Amount has too many decimal places.');}
 if(amount<=0n||amount>=2n**256n)throw Error('Enter a positive amount within the supported range.');
 const fromAddress=from.network==='Solana'?a.wallet.solanaAddress:a.wallet.evmAddress,toAddress=to.network==='Solana'?a.wallet.solanaAddress:a.wallet.evmAddress;
 const params=new URLSearchParams({fromChain:String(from.chainId),toChain:String(to.chainId),fromToken:from.address,toToken:to.address,fromAddress,toAddress,fromAmount:String(amount),slippage:String(a.slippageBps/10000),integrator:'drivekey',fee:'0'});
 let response:Response;
 try{response=await fetcher('https://li.quest/v1/quote?'+params,{method:'GET',headers:{accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});}catch{throw Error('LI.FI did not respond. Try getting a fresh quote. Nothing was submitted.');}
 if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'LI.FI rate limit reached. Try again later.':response.status===404?'LI.FI found no route for these assets and amount.':'LI.FI could not quote this route. Try another amount or pair.');}
 let q:z.infer<typeof quoteSchema>;try{q=quoteSchema.parse(await readBounded(response));}catch{throw Error('LI.FI returned incomplete or unsupported quote details.');}
 const action=q.action;
 for(const [actual,expected] of [[action.fromToken,from],[action.toToken,to]] as const){if(actual.chainId!==expected.chainId||actual.decimals!==expected.decimals||!equal(actual.address,expected.address,expected.chainId))throw Error('LI.FI returned a different token or network.');}
 if(action.fromChainId!==from.chainId||action.toChainId!==to.chainId||!equal(action.fromAddress,fromAddress,from.chainId)||!equal(action.toAddress,toAddress,to.chainId)||action.fromAmount!==String(amount)||q.estimate.fromAmount!==String(amount)||Math.abs(action.slippage-a.slippageBps/10000)>1e-9)throw Error('LI.FI quote does not match your request.');
 if(BigInt(q.estimate.toAmountMin)<=0n||BigInt(q.estimate.toAmountMin)>BigInt(q.estimate.toAmount))throw Error('LI.FI returned invalid receive amounts.');
 const costs=(items:z.infer<typeof cost>[])=>items.map(c=>({name:c.name||c.type||'Provider cost',amount:formatUnits(c.amount,c.token.decimals),symbol:c.token.symbol,chainId:c.token.chainId,address:c.token.address,included:c.included??null}));
 // Deliberately discard transactionRequest and approvalAddress. Quotes cannot enter the signer or broadcast API.
 return {provider:'LI.FI',quoteId:q.id,route:q.toolDetails.name,checkedAt:new Date().toISOString(),refreshAfterSeconds:60,from:a.from,to:a.to,fromAddress,toAddress,sendAmount:formatUnits(amount,from.decimals),receiveAmount:formatUnits(q.estimate.toAmount,to.decimals),minimumReceived:formatUnits(q.estimate.toAmountMin,to.decimals),slippageBps:a.slippageBps,durationSeconds:q.estimate.executionDuration,fees:costs(q.estimate.feeCosts),gas:costs(q.estimate.gasCosts),signingEnabled:false,notice:'Comparison quote only. Use the dedicated ETH → USDC preparation flow for executable Ethereum approvals. Other routes are not yet signable. No funds are reserved or moved.'};
}
