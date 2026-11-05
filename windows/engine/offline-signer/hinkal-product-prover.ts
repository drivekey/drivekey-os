// Offline proving only. Neither spending authority nor viewing keys leave here.
import {getAddress} from 'ethers';
import nacl from 'tweetnacl';
import path from 'node:path';
import {HINKAL_PIN} from '../core/hinkal-intent';
import {validateProductProof,verifyProductProofResponse} from '../core/hinkal-product-proof';
import {localProductProvingSupported,productAuthorizationHash,verifyProductProofResult} from '../core/hinkal-product-result';
import {reviewProductProof} from './hinkal-product-proof';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret,retainedSolSecret} from './sol-secret';
import {proveLocalHinkalSwap} from './hinkal-local-evm-swap';
import {proveLocalHinkalSolanaSwap} from './hinkal-local-solana-swap';
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs');
export async function proveProductProof(vault:any,password:string,request:unknown,response:unknown,artifactDirectory:string,now=Date.now()){
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),r=validateProductProof(structuredClone(request),now);
 reviewProductProof(r,vault,now);
 if(!localProductProvingSupported(r))throw Error('This proof profile requires a separately integrated provider finalizer; no local substitution is allowed.');
 if(typeof artifactDirectory!=='string'||!path.isAbsolute(artifactDirectory))throw Error('A pinned proving artifact directory is required.');
 const auth=await verifyProductProofResponse(r,structuredClone(response),clock()),keys=await unlockMultiVault(vault,password);
 let view:any;
 try{
  validateProductProof(r,clock());await preProcessing();
  const signature=r.chain==='ethereum'?await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage):'0x'+Buffer.from(nacl.sign.detached(Buffer.from(HINKAL_PIN.sdkLoginMessage),retainedSolSecret(keys.sol))).toString('hex');
  const identity=new UserKeys(signature),address=r.chain==='ethereum'?keys.evm.address:keys.sol.publicKey.toBase58();
  if(r.chain==='ethereum'?getAddress(address)!==getAddress(r.wallet.evmAddress):address!==r.wallet.solanaAddress)throw Error('Private prover belongs to another wallet.');
  view={chain:r.chain,address,nullifyingKey:identity.getShieldedPrivateKey(),spendingPublicKey:identity.getSpendingKeyPair().pubSpendingBJJPoint.map(String),readOnly:true,testOnly:true};
  const input={seed:r.seed,authorization:auth.proofAuthorization,view,artifactDirectory};
  const proof=r.chain==='ethereum'?await proveLocalHinkalSwap(input):await proveLocalHinkalSolanaSwap(input);
  const result={version:28,kind:'drivekey-hinkal-product-proof-result',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,
   authorizationHash:productAuthorizationHash(auth),createdAt:new Date(clock()).toISOString(),chain:r.chain,proof,blockchainTransactionSigned:false,submitted:false};
  const verified=await verifyProductProofResult(r,auth,result,clock());validateProductProof(r,clock());return verified;
 }finally{wipeSolSecret(keys.sol);if(view){view.nullifyingKey=undefined;view=undefined;}}
}
