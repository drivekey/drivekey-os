import {AbiCoder,Interface,Transaction,getCreate2Address,keccak256} from 'ethers';
import {ETH_TOKENS,ROUTER,SWAP_ROUTER,TOKEN} from './trade-protocol';

// Ethereum mainnet factory; pool derivation follows v3-periphery PoolAddress.sol.
export const UNISWAP_V3_FACTORY='0x1F98431c8aD98523631AE4a59f267346ea31F984';
const POOL_INIT_CODE_HASH='0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';
const events=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']);
export function ethereumSwapPool(fee:number){
 if(fee!==500&&fee!==3000)throw Error('Unsupported Ethereum pool fee.');
 const tokens=[ETH_TOKENS.WETH.address,ETH_TOKENS.USDC.address].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
 return getCreate2Address(UNISWAP_V3_FACTORY,keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24'],[...tokens,fee])),POOL_INIT_CODE_HASH);
}
type Log={address:string;topics:string[];data:string;removed?:boolean};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
function logsFor(input:unknown,address:string,event:string){
 if(!Array.isArray(input)||input.length>128)throw Error('Missing or oversized receipt log evidence.');
 const topic=events.getEvent(event)!.topicHash;
 return input.filter((l:Log)=>typeof l?.address==='string'&&same(l.address,address)&&Array.isArray(l.topics)&&l.topics[0]===topic).map((l:Log)=>{
  if(l.removed||l.topics.length!==3||typeof l.data!=='string')throw Error('Invalid receipt event.');
  const parsed=events.parseLog(l);if(!parsed)throw Error('Invalid receipt event.');
  const canonical=events.encodeEventLog(event,[...parsed.args]);if(canonical.data.toLowerCase()!==l.data.toLowerCase()||canonical.topics.some((t,i)=>!same(t,l.topics[i])))throw Error('Noncanonical receipt event.');
  return parsed.args;
 });
}
/** Complements exact transaction/receipt/finality checks. Events do not certify arbitrary contracts. */
export function ethereumDeliveryEvidence(raw:string,logs:unknown,blockTimestamp?:bigint){
 const tx=Transaction.from(raw);if(!tx.from||!tx.to||tx.chainId!==1n)throw Error('Invalid Ethereum signed transaction.');
 if(tx.data==='0x'&&tx.value>0n)return {verified:true,kind:'native-payment',message:'Exact native value and recipient matched finalized transaction evidence.'};
 try{
  if(tx.value!==0n)throw Error('Unsupported token value.');
  const token=Object.values(ETH_TOKENS).find(t=>same(t.address,tx.to!));
  if(token){
   const call=TOKEN.parseTransaction({data:tx.data});if(!call||!['transfer','approve'].includes(call.name)||TOKEN.encodeFunctionData(call.name,[...call.args])!==tx.data)throw Error('Unsupported token call.');
   const [recipient,amount]=call.args;if(amount<=0n)throw Error('Invalid token amount.');
   const name=call.name==='transfer'?'Transfer':'Approval';if(name==='Approval'&&!same(recipient,SWAP_ROUTER))throw Error('Unsupported approval spender.');
   const matched=logsFor(logs,token.address,name);
   const verified=matched.length===1&&same(matched[0][0],tx.from)&&same(matched[0][1],recipient)&&matched[0][2]===amount;
   return {verified,kind:call.name==='transfer'?'token-payment':'approval',message:verified?'Exact canonical token event matches the approved action.':'Finalized transaction lacks a unique exact token event. Do not resend.'};
  }
  if(!same(tx.to,SWAP_ROUTER))throw Error('Unsupported Ethereum destination.');
  const call=ROUTER.parseTransaction({data:tx.data});if(!call||call.name!=='exactInputSingle'||ROUTER.encodeFunctionData(call.name,[...call.args])!==tx.data)throw Error('Unsupported swap call.');
  const p=call.args[0],input=Object.values(ETH_TOKENS).find(t=>same(t.address,p.tokenIn)),output=Object.values(ETH_TOKENS).find(t=>same(t.address,p.tokenOut));
  if(!input||!output||input===output||!same(p.recipient,tx.from)||p.amountIn<=0n||p.amountOutMinimum<=0n||p.sqrtPriceLimitX96!==0n)throw Error('Unsupported swap constraints.');
  const pool=ethereumSwapPool(Number(p.fee)),incoming=logsFor(logs,input.address,'Transfer'),outgoing=logsFor(logs,output.address,'Transfer'),swaps=logsFor(logs,pool,'Swap');
  if(incoming.length!==1||outgoing.length!==1||swaps.length!==1)throw Error('Missing unique swap events.');
  const i=incoming[0],o=outgoing[0],s=swaps[0],inputIs0=input.address.toLowerCase()<output.address.toLowerCase();
  const verified=blockTimestamp!==undefined&&blockTimestamp<=p.deadline&&same(i[0],tx.from)&&same(i[1],pool)&&i[2]===p.amountIn&&same(o[0],pool)&&same(o[1],p.recipient)&&o[2]>=p.amountOutMinimum&&same(s[0],SWAP_ROUTER)&&same(s[1],p.recipient)&&(inputIs0?s[2]:s[3])===p.amountIn&&(inputIs0?s[3]:s[2])===-o[2];
  return {verified,kind:'swap',pool,minimumOutput:p.amountOutMinimum.toString(),received:o[2].toString(),message:verified?'Exact input, output minimum, pool event and execution deadline matched.':'Finalized swap evidence does not match the approved amounts, recipient, pool or deadline. Do not resend.'};
 }catch{return {verified:false,kind:'unverified',message:'Finalized transaction lacks complete supported asset-delivery evidence. Do not resend.'};}
}

