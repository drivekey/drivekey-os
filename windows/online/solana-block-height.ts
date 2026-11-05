import {PublicKey} from '@solana/web3.js';
import type {OnlineAdapter} from './adapter';
// A slot is not a block height. Verify the height against the block represented
// by the same-commitment epoch response instead of trusting an ambiguous scalar.
// No transaction blockhash, last-valid height, deadline or clock is changed.
export async function verifiedSolanaBlockHeight(adapter:OnlineAdapter,commitment:'confirmed'|'finalized'='confirmed',minContextSlot?:number):Promise<number>{
 if(!['confirmed','finalized'].includes(commitment))throw Error('Unsupported verified-height commitment.');
 if(minContextSlot!==undefined&&(!Number.isSafeInteger(minContextSlot)||minContextSlot<0))throw Error('Invalid minimum block-height context.');
 const e=await adapter.rpc('solana','getEpochInfo',[{commitment}]);
 if(!Number.isSafeInteger(e?.absoluteSlot)||!Number.isSafeInteger(e?.blockHeight)||e.blockHeight<0||e.absoluteSlot<e.blockHeight)throw Error('Invalid epoch block-height observation.');
 if(minContextSlot!==undefined&&e.absoluteSlot<minContextSlot)throw Error('Block-height observation precedes the requested context.');
 const b=await adapter.rpc('solana','getBlock',[e.absoluteSlot,{commitment,transactionDetails:'none',rewards:false,maxSupportedTransactionVersion:0}]);
 if(!b||b.blockHeight!==e.blockHeight||typeof b.blockhash!=='string'||new PublicKey(b.blockhash).toBytes().length!==32)throw Error('Epoch and canonical block height disagree.');
 return e.blockHeight as number;
}
