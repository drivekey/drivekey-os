// No network. The outer wallet approval is created BEFORE transferable bytes.
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {verifyProductChain,validateProductChain,productChainApproval,verifyProductChainResponse} from '../core/hinkal-product-chain';
import {unlockMultiVault} from './multi-vault';
import {retainedSolSecret,wipeSolSecret} from './sol-secret';
import {signHinkalEvmSwap} from './hinkal-evm-swap';
import {signHinkalSolanaSwap} from './hinkal-solana-swap';
import {signHinkal} from './hinkal';
import {signHinkalSolanaSpend} from './hinkal-solana-spend';
export async function signProductChain(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),r=await verifyProductChain(input,vault.public,clock());
 if(r.fingerprint!==fingerprint)throw Error('Product chain review changed.');
 const keys=await unlockMultiVault(vault,password);let approvalSignature:string;
 try{
  validateProductChain(r,clock());const message=productChainApproval(r);
  approvalSignature=r.chain==='ethereum'?await keys.evm.signMessage(message):bs58.encode(nacl.sign.detached(Buffer.from(message),retainedSolSecret(keys.sol)));
 }finally{wipeSolSecret(keys.sol);}
 // Inner signers reconstruct owned inputs and verify the exact proof. Their
 // monotonic deadline is already capped by the outer approval. No replacements.
 validateProductChain(r,clock());const inner:any=r.chainRequest;
 const sign=inner.version===10?signHinkal:inner.version===16?signHinkalSolanaSpend:inner.version===18?signHinkalEvmSwap:signHinkalSolanaSwap;
 const signed=await sign(vault,password,inner,inner.fingerprint,clock());
 const response={version:29,kind:'drivekey-hinkal-product-chain-response',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,
  signedAt:signed.signedAt,rawSignedTransaction:signed.rawSignedTransaction,transactionHash:signed.transactionHash,innerApprovalSignature:signed.approvalSignature,approvalSignature};
 // Recoverable signed bytes stay valid for historical verification after the
 // offchain deadline. A new signing attempt always validates current expiry.
 return verifyProductChainResponse(response,r,vault.public,clock(),false);
}
