// Public, already-authorized proof inputs only. No vault, viewing key or signer.
import {prepareProductChain} from '../engine/core/hinkal-product-admission';
import {HinkalEvmSwapAdapter} from './hinkal-evm-swap';
import {HinkalSolanaSwapAdapter} from './hinkal-solana-swap';
import {OnlineAdapter} from './adapter';
import {HinkalDirectAdapter} from './hinkal-direct';
import {HinkalSolanaSpendAdapter} from './hinkal-solana-spend';
export async function prepareProductProofPackage(adapter:OnlineAdapter,input:unknown,wallet:unknown,now=Date.now()){
 return prepareProductChain((chain,args,w,at)=>{const seed=args.seed,c=seed.job.context;if(seed.version===13)return new HinkalDirectAdapter(adapter).prepare({action:'hinkal-'+c.action,asset:c.asset,amount:c.amount,recipient:c.recipient,data:args.proof.transaction.data,inputNotes:c.inputNotes,proofExpiresAt:args.productExpiresAt,proofMaximumFee:seed.maximumFee,proofNonce:seed.nonce,...c.action==='transfer'?{recipientInfo:c.recipientInfo,recipientBindingSignature:c.recipientBindingSignature,recipientAcknowledgement:seed.recipientAcknowledgement,proofFingerprint:seed.fingerprint}:{}},w,at);if(seed.version===15)return new HinkalSolanaSpendAdapter(adapter).prepare(args,w,at);return chain==='ethereum'?new HinkalEvmSwapAdapter(adapter).prepare(args,w,at):new HinkalSolanaSwapAdapter(adapter).prepare(args,w,at);},input,wallet,now);
}
