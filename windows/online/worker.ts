import {LifiRelayDestinationAdapter} from './lifi-relay-destination';
import {LifiMayanSolanaDestinationAdapter} from './lifi-mayan-solana-destination';
import {LifiRelaySourceAdapter} from './lifi-relay-source';
import {LifiMayanEvmSourceAdapter} from './lifi-mayan-evm-source';
import {MayanEvmRedeemAdapter} from './mayan-evm-redeem';
import {MayanSolanaSourceAdapter} from './mayan-solana-source';
import {HinkalSolanaSwapAdapter} from './hinkal-solana-swap';
import {HinkalEvmSwapAdapter} from './hinkal-evm-swap';
import {HinkalSolanaSpendAdapter} from './hinkal-solana-spend';
import {HinkalSolanaAdapter} from './hinkal-solana';
import { OnlineAdapter } from './adapter';
import { LifiQuotes, UniswapQuotes } from './providers';
import { UniswapAdapter } from './uniswap';
import { LifiEvmAdapter } from './lifi-evm';
import { LifiSolanaAdapter } from './lifi-solana';
import { HinkalDirectAdapter } from './hinkal-direct';
const paymentPolicy = require('../tools/store-payment-policy.cjs');
let bytes=0;const parts:Buffer[]=[];
process.stdin.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>256*1024)process.exit(2);parts.push(b);});
process.stdin.on('end',async()=>{
 try{
  const j=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(j.password||j.vault||j.privateKey||j.seed)throw Error('Secrets are forbidden in the online adapter.');
  paymentPolicy.assertOnlineJob(j);
  const adapter=new OnlineAdapter(j.endpoints);let result;
  switch(j.action){
   case 'lifi-relay-destination-reconcile':result=await new LifiRelayDestinationAdapter(adapter).reconcile(j.request,j.response);break;
   case 'lifi-relay-source-reconcile':result=await new LifiRelaySourceAdapter(adapter).reconcile(j.request,j.response);break;
   case 'lifi-mayan-solana-destination-reconcile':result=await new LifiMayanSolanaDestinationAdapter(adapter).reconcile(j.request,j.response);break;
   case 'lifi-mayan-evm-source-reconcile':result=await new LifiMayanEvmSourceAdapter(adapter).reconcile(j.request,j.response);break;
   case 'mayan-evm-redeem-reconcile':result=await new MayanEvmRedeemAdapter(adapter).reconcile(j.request,j.response);break;
   case 'mayan-solana-source-reconcile':result=await new MayanSolanaSourceAdapter(adapter).reconcile(j.request,j.response);break;
   case 'prepare':result=await adapter.prepare(j.input,j.wallet);break;
   case 'observed-balance':result=await adapter.balance(j.chain,j.from,j.asset,'latest');break;
   case 'balance':result=await adapter.balance(j.chain,j.from,j.asset);break;
   case 'preflight':result=await adapter.preflight(j.request);break;
   case 'broadcast':result=await adapter.broadcast(j.request,j.response);break;
   case 'reconcile':result=await adapter.reconcile(j.request,j.response);break;
   case 'lifi-evm-reconcile':result=await new LifiEvmAdapter(adapter).reconcile(j.request,j.response);break;
   case 'lifi-solana-reconcile':result=await new LifiSolanaAdapter(adapter).reconcile(j.request,j.response);break;
   case 'uniswap-v3-reconcile':result=await new UniswapAdapter(adapter).reconcile(j.request,j.response);break;
   case 'hinkal-solana-swap-reconcile':result=await new HinkalSolanaSwapAdapter(adapter).reconcile(j.request,j.response);break;
   case 'hinkal-evm-swap-reconcile':result=await new HinkalEvmSwapAdapter(adapter).reconcile(j.request,j.response);break;
   case 'hinkal-solana-spend-reconcile':result=await new HinkalSolanaSpendAdapter(adapter).reconcile(j.request,j.response);break;
   case 'hinkal-solana-reconcile':result=await new HinkalSolanaAdapter(adapter).reconcile(j.request,j.response);break;
   case 'hinkal-direct-reconcile':result=await new HinkalDirectAdapter(adapter).reconcile(j.request,j.response);break;
   default:throw Error('Unsupported online operation.');
  }
  process.stdout.write(JSON.stringify({ok:true,result:result??null}),()=>process.exit(0));
 }catch{process.stdout.write(JSON.stringify({ok:false,error:'Online operation failed. Check RPC identity, funds, fees, expiry and connectivity; reconcile pending transactions before retrying.'}),()=>process.exit(1));}
});
