// No provider client, relayer, RPC or transaction broadcast. One-use child only.
import {getAddress} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {validateProductProof,productProofReview,productProofWalletMessage,verifyProductProofResponse} from '../core/hinkal-product-proof';
import {signHinkalProof} from './hinkal-proof';
import {signHinkalSolanaProof} from './hinkal-solana-proof';
import {signLocalHinkalSwap} from './hinkal-local-evm-swap';
import {signLocalHinkalSolanaSwap} from './hinkal-local-solana-swap';
import {unlockMultiVault} from './multi-vault';
import {retainedSolSecret,wipeSolSecret} from './sol-secret';
import {inspectProductNotesWithKeys} from './private-note-manifest';

export function reviewProductProof(input:unknown,vault:any,now=Date.now(),expiry=true){
 const r=validateProductProof(input,now,expiry);
 if(r.deviceId!==vault?.public?.deviceId||getAddress(r.wallet.evmAddress)!==getAddress(vault.public.evmAddress)||
    r.wallet.solanaAddress!==vault.public.solanaAddress)throw Error('Product proof wallet differs from the loaded vault.');
 return productProofReview(r,now,expiry);
}

export async function authorizeProductProof(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now(),noteManifestFingerprint?:string){
 // Snapshot before unlock, then advance time monotonically across expensive crypto.
 const r=validateProductProof(JSON.parse(JSON.stringify(input)),now);reviewProductProof(r,vault,now);
 if(r.fingerprint!==fingerprint)throw Error('Product proof review changed.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),seed:any=r.seed;
 const authorize=seed.version===13?signHinkalProof:seed.version===15?signHinkalSolanaProof:seed.version===19?signLocalHinkalSwap:signLocalHinkalSolanaSwap;
 // Unlock the attestation key before creating the circuit authorization. The
 // inner boundary must validate the original outer deadline, which can be
 // earlier than the seed deadline. Neither request nor clock is rewritten.
 const keys=await unlockMultiVault(vault,password);
 try{
  if(noteManifestFingerprint!==undefined){const notes=await inspectProductNotesWithKeys(r,keys,clock());if(notes.fingerprint!==noteManifestFingerprint)throw Error('Reserved private-note manifest differs from the independently owned inputs.');}
  validateProductProof(r,clock());let signingAt:number|undefined;
  const proofAuthorization=await authorize(vault,password,seed,seed.fingerprint,clock(),at=>{validateProductProof(r,at);signingAt=at;});
  if(signingAt===undefined||proofAuthorization.signedAt!==new Date(signingAt).toISOString())throw Error('Product proof signing boundary differs.');
  // This signature attests to an already-created, exactly bound authorization.
  // Finish and retain that response even if delivery crosses the deadline.
  const signedAt=proofAuthorization.signedAt,message=productProofWalletMessage(r,proofAuthorization,signedAt);
  const walletAuthorization=r.chain==='ethereum'?await keys.evm.signMessage(message):bs58.encode(nacl.sign.detached(Buffer.from(message),retainedSolSecret(keys.sol)));
  const response={version:28,kind:'drivekey-hinkal-product-proof-response',requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,
   signedAt,proofAuthorization,walletAuthorization,blockchainTransactionSigned:false,submitted:false};
  return verifyProductProofResponse(r,response,clock(),false);
 }finally{wipeSolSecret(keys.sol);}
}
