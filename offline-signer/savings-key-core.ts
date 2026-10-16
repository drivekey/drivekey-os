// No media/file/JSON input. Only fixed-purpose binary setup proofs; never transactions.
import {decodeSetupSigningFrame,encodeProofSignature} from './savings-boundary-codec';
import {setupApprovalFingerprint,setupFingerprint,setupProofMessage,verifySetupProof} from '../core/savings-setup';
import {unlockMultiVault} from './multi-vault';
export async function signSetupFrame(frame:Buffer){
 const {setup,vault,password,fingerprint,purpose}=decodeSetupSigningFrame(frame),signer=vault.public.evmAddress;
 if(fingerprint!==setupApprovalFingerprint(setup,purpose,signer))throw Error('Review does not match signing command.');
 const message=setupProofMessage(setup,purpose,signer),keys=await unlockMultiVault(vault,password);
 let retainedSolSecret:Uint8Array|undefined;
 try{
  // Pinned web3.js exposes a public getter that returns a copy. Clear its actual
  // retained buffer; a different storage layout fails closed before signing.
  const storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value;
  const secret=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;
  if(!(secret instanceof Uint8Array)||secret.byteLength!==64)throw Error('Unsupported decrypted key storage.');
  retainedSolSecret=secret;
  const proof=verifySetupProof({kind:'drivekey-savings-setup-proof',version:1,fingerprint:setupFingerprint(setup),purpose,signer,signature:await keys.evm.signMessage(message)},setup);
  return encodeProofSignature(proof.signature);
 }finally{retainedSolSecret?.fill(0);}
 // The one-shot worker exits before the broker reads more media. JS EVM strings
 // cannot be reliably erased; this is not a hardware/constant-time assurance claim.
}
