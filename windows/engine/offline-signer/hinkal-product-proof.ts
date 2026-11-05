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

export function reviewProductProof(input:unknown,vault:any,now=Date.now(),expiry=true){
 const r=validateProductProof(input,now,expiry);
 if(r.deviceId!==vault?.public?.deviceId||getAddress(r.wallet.evmAddress)!==getAddress(vault.public.evmAddress)||
    r.wallet.solanaAddress!==vault.public.solanaAddress)throw Error('Product proof wallet differs from the loaded vault.');
 return productProofReview(r,now,expiry);
}

export async function authorizeProductProof(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 // Snapshot before unlock, then advance time monotonically across expensive crypto.
 const r=validateProductProof(JSON.parse(JSON.stringify(input)),now);reviewProductProof(r,vault,now);
 if(r.fingerprint!==fingerprint)throw Error('Product proof review changed.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),seed:any=r.seed;
 const authorize=seed.version===13?signHinkalProof:seed.version===15?signHinkalSolanaProof:seed.version===19?signLocalHinkalSwap:signLocalHinkalSolanaSwap;
 const proofAuthorization=await authorize(vault,password,seed,seed.fingerprint,clock());
 validateProductProof(r,clock());
 // The circuit authorization alone cannot be imported as a product response:
 // this separate domain signature binds it to the exact v28 native review.
 const keys=await unlockMultiVault(vault,password);
 try{
  validateProductProof(r,clock());const signedAt=new Date(clock()).toISOString(),message=productProofWalletMessage(r,proofAuthorization,signedAt);
  const walletAuthorization=r.chain==='ethereum'?await keys.evm.signMessage(message):bs58.encode(nacl.sign.detached(Buffer.from(message),retainedSolSecret(keys.sol)));
  const response={version:28,kind:'drivekey-hinkal-product-proof-response',requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,
   signedAt,proofAuthorization,walletAuthorization,blockchainTransactionSigned:false,submitted:false};
  return verifyProductProofResponse(r,response,clock());
 }finally{wipeSolSecret(keys.sol);}
}
