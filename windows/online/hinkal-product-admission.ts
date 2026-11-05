// Public, already-authorized proof inputs only. No vault, viewing key or signer.
import {prepareProductChain} from '../engine/core/hinkal-product-admission';
import {HinkalEvmSwapAdapter} from './hinkal-evm-swap';
import {HinkalSolanaSwapAdapter} from './hinkal-solana-swap';
import {OnlineAdapter} from './adapter';
export async function prepareProductProofPackage(adapter:OnlineAdapter,input:unknown,wallet:unknown,now=Date.now()){
 return prepareProductChain((chain,args,w,at)=>chain==='ethereum'?new HinkalEvmSwapAdapter(adapter).prepare(args,w,at):new HinkalSolanaSwapAdapter(adapter).prepare(args,w,at),input,wallet,now);
}
