// Secret process only. Fixed two signing operations; no arbitrary hash/types.
import {Wallet,decryptKeystoreJson,getAddress} from 'ethers';
import {unlockMultiVault} from './multi-vault';
import {validateRulesDraft,validateRulesApproval,policyFingerprint,paymentApprovalFingerprint,rulesDomain,policyMessage,POLICY_TYPES,PAYMENT_APPROVAL_TYPES,verifySignedRules,verifySignedRulesPayment} from '../core/rules-protocol';
import {decodeRulesCommand,encodeRulesResult} from './rules-boundary-codec';
import {validateRulesSigningRequest} from './rules-validation';
export async function signRulesFrame(frame:Buffer){
 let retained:Uint8Array|undefined,account:Awaited<ReturnType<typeof decryptKeystoreJson>>|undefined;
 try{
  const c=decodeRulesCommand(frame),request=validateRulesSigningRequest(c.operation,c.request),fingerprint=c.operation==='policy'?policyFingerprint(validateRulesDraft(request)):paymentApprovalFingerprint(validateRulesApproval(request));
  if(c.fingerprint!==fingerprint)throw Error('Rules approval fingerprint changed');
  const context=request.context,expected=c.operation==='policy'?context.owner:context.rules!.approver;
  const publicAddress=c.vault.version===2?c.vault.public.address:c.vault.public.evmAddress;
  if(getAddress(publicAddress)!==getAddress(expected))throw Error('Wrong owner or separate approver vault');
  let signer:Wallet;
  if(c.vault.version===2){account=await decryptKeystoreJson(JSON.stringify(c.vault.keystore),c.password);signer=new Wallet(account.privateKey);}
  else{
   const keys=await unlockMultiVault(c.vault,c.password),storage=Object.getOwnPropertyDescriptor(keys.sol,'_keypair')?.value;
   const bytes=storage&&Object.getOwnPropertyDescriptor(storage,'secretKey')?.value;if(!(bytes instanceof Uint8Array)||bytes.length!==64)throw Error('Unsupported secret storage');retained=bytes;signer=keys.evm;
   if(keys.sol.publicKey.toBase58()!==c.vault.public.solanaAddress)throw Error('Solana vault identity mismatch');
  }
  if(getAddress(signer.address)!==getAddress(expected)||getAddress(signer.address)!==getAddress(publicAddress))throw Error('Decrypted authority mismatch');
  validateRulesSigningRequest(c.operation,request);
  const signature=c.operation==='policy'?await signer.signTypedData(rulesDomain(context),POLICY_TYPES,policyMessage(validateRulesDraft(request))):await signer.signTypedData(rulesDomain(context),PAYMENT_APPROVAL_TYPES,validateRulesApproval(request).payment);
  validateRulesSigningRequest(c.operation,request);const signedAt=new Date().toISOString();
  if(c.operation==='policy')verifySignedRules({kind:'drivekey-rules-authorization',version:1,draft:request,fingerprint,signature,signedAt});
  else verifySignedRulesPayment({kind:'drivekey-rules-payment-signature',version:1,request,fingerprint,signature,signedAt});
  return encodeRulesResult(c.binding,fingerprint,signature,signedAt);
 }finally{frame.fill(0);retained?.fill(0);if(account)account.privateKey='';}
 // JS strings/library copies cannot be promised erased; process exit is required.
}
