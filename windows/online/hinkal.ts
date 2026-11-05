// Public discovery only; execution is gated until the proof/signing decoder is qualified.
// SDK logging is suppressed by the dedicated process, never by the normal signer.
// Import only the supported SDK 0.4.1 quote/fee helpers. The root Hinkal class
// also loads unused NEAR refund/bridge modules and their vulnerable elliptic
// dependency. Keep one CJS graph so crypto initialization is shared.
const {resolveErc20Tokens}=require('../node_modules/@hinkal/common/common/src/functions/utils/erc20tokenFunctions.cjs'),
 {getLifiPrice}=require('../node_modules/@hinkal/common/common/src/functions/web3/lifiAPI.cjs'),
 {getOKXPrice}=require('../node_modules/@hinkal/common/common/src/functions/web3/okxAPI.cjs'),
 {getExternalSwapAddress}=require('../node_modules/@hinkal/common/common/src/functions/pre-transaction/getExternalSwapAddress.cjs'),
 {getFeeStructure}=require('../node_modules/@hinkal/common/common/src/functions/pre-transaction/getFeeStructure.cjs'),
 {ExternalActionId}=require('../node_modules/@hinkal/common/common/src/types/external-action.types.cjs');
import {z} from 'zod';
import {CHAINS} from '../engine/core/payment-intent';
import {formatUnits} from 'ethers';
// SDK 0.4.1's public Solana quote method assumes its cryptography was initialized
// by a prepare* helper. Initialize the pinned routine without invoking wallet login.
const {preProcessing}:{preProcessing:()=>Promise<void>}=require('../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs');
import {HINKAL_PIN} from '../engine/core/hinkal-intent';
export {HINKAL_PIN};
const native={ethereum:'0x0000000000000000000000000000000000000000',solana:'11111111111111111111111111111111'};
export async function hinkalDiscover(input:unknown){
 const p=z.object({chain:z.enum(['ethereum','solana']),action:z.enum(['withdrawal-fee','swap-fee','swap-quote']),tokenIn:z.enum(['ETH','SOL','USDC']),amount:z.string().regex(/^[1-9][0-9]*$/).max(38)}).strict().parse(input);
 const c=CHAINS[p.chain];if(p.tokenIn!==c.native&&p.tokenIn!=='USDC')throw Error('Hinkal chain/asset mismatch.');
 const chainId=p.chain==='ethereum'?1:501,tokenIn=p.tokenIn==='USDC'?c.usdc:native[p.chain],tokenOut=p.tokenIn==='USDC'?native[p.chain]:c.usdc;
 await preProcessing();
 let result:any;
 if(p.action==='swap-quote'){
  const [source,target]=await resolveErc20Tokens(chainId,[tokenIn,tokenOut]),humanAmount=formatUnits(p.amount,p.tokenIn==='USDC'?6:c.decimals);
  // Preserve the root SDK's quote parameters, result shape and failure behavior.
  try{
   if(p.chain==='ethereum'){
    const quote=await getLifiPrice(source,target,humanAmount,0.007,getExternalSwapAddress(chainId,ExternalActionId.Lifi));
    result={outSwapAmountValue:quote.outSwapAmountValue,lifiDataValue:quote.lifiDataValue};
   }else result=await getOKXPrice(chainId,source,target,humanAmount);
  }catch{result=null;}
 }else result=await getFeeStructure(chainId,c.usdc,p.action==='swap-fee'?[tokenIn,tokenOut]:[tokenIn],p.action==='swap-fee'?(p.chain==='ethereum'?'Lifi':'Okx'):'Transact',[],p.action==='swap-fee'?35n:25n);
 if(!result)throw Error('No Hinkal quote or fee is available at this input.');
 return {provider:'hinkal',pin:HINKAL_PIN,request:p,result,evidenceLevel:'live-public-provider-read',executionEnabled:false,remaining:'Proof intent, contract/program decoding, bounded source signing, independent private-balance/destination settlement and recovery qualification'};
}
