import {OnlineAdapter} from './adapter';
import {HinkalEvmSwapAdapter} from './hinkal-evm-swap';
import {HinkalSolanaSwapAdapter} from './hinkal-solana-swap';
import {HinkalDirectAdapter} from './hinkal-direct';
import {HinkalSolanaSpendAdapter} from './hinkal-solana-spend';
import {verifyProductChain,verifyProductChainResponse,productInnerResponse} from '../engine/core/hinkal-product-chain';

// Verify the complete approval BEFORE handing exact inner bytes to a provider.
// Reconciliation is read-only and remains available after application expiry.
export async function productChainOperation(adapter:OnlineAdapter,operation:'preflight'|'broadcast'|'reconcile',input:any,response?:unknown){
 const started=performance.now(),now=Date.now(),clock=()=>now+Math.floor(performance.now()-started),wallet=structuredClone(input?.package?.request?.wallet);
 const r=await verifyProductChain(input,wallet,clock(),operation!=='reconcile');
 const s=operation==='preflight'?null:await verifyProductChainResponse(response,r,wallet,clock(),operation!=='reconcile');
 const version=(r.chainRequest as any).version,provider:any=version===10?new HinkalDirectAdapter(adapter):version===16?new HinkalSolanaSpendAdapter(adapter):version===18?new HinkalEvmSwapAdapter(adapter):new HinkalSolanaSwapAdapter(adapter);
 if(operation==='preflight')return provider.preflight(r.chainRequest);
 // No automatic retries or replacements; existing adapters reconcile exact hash.
 return provider[operation](r.chainRequest,productInnerResponse(r,s));
}
