// Offline-only. No caller-selected messages, EIP-712 types or calldata.
import {z} from 'zod';
import {Wallet,decryptKeystoreJson,verifyTypedData} from 'ethers';
import {readJsonFile,writeJsonFile,safeDirectory} from '../core/files';
import {assertOfflineEnvironment} from './environment';
import {validateVault} from './vault';
import {multiVaultSchema,unlockMultiVault} from './multi-vault';
import {RULES_FILES,rulesContextSchema,rulesDraftSchema,validateRulesDraft,policyFingerprint,policyMessage,rulesDomain,POLICY_TYPES,verifySignedRules,rulesChanges,rulesExplanation} from '../core/rules-protocol';
import {validateRulesApproval,paymentApprovalFingerprint,PAYMENT_APPROVAL_TYPES} from '../core/rules-protocol';
import {rulesExposure} from '../core/rules-protocol';
const base={scope:z.literal('rules'),profile:z.enum(['eth','multi'])};
const command=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('context')}).strict(),
 z.object({...base,action:z.literal('save'),draft:rulesDraftSchema}).strict(),
 z.object({...base,action:z.literal('review')}).strict(),
 z.object({...base,action:z.literal('sign'),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/i),consent:z.literal(true),password:z.string().max(256)}).strict(),
 z.object({...base,action:z.literal('inspect-approval')}).strict(),
 z.object({...base,action:z.literal('sign-approval'),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/i),consent:z.literal(true),password:z.string().max(256)}).strict(),
]);
export async function rulesOfflineAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();await safeDirectory(directory);
 if(c.action==='inspect-approval'||c.action==='sign-approval'){
  const request=validateRulesApproval(await readJsonFile(directory,'rules-payment-approval.json'));
  const fingerprint=paymentApprovalFingerprint(request);
  if(c.action==='inspect-approval')return {approval:request,fingerprint,message:'Last reported online '+request.context.reportedAt+'. Approving this exact payment does not bypass current hard caps.'};
  if(c.fingerprint!==fingerprint)throw Error('Payment changed since review.');
  let signer:Wallet,cleanup=()=>{};
  if(c.profile==='eth'){const v=validateVault(await readJsonFile(directory,'vault-encrypted.json'));signer=new Wallet((await decryptKeystoreJson(JSON.stringify(v.keystore),c.password)).privateKey);}
  else {const keys=await unlockMultiVault(multiVaultSchema.parse(await readJsonFile(directory,'vault-multi-encrypted.json')),c.password);signer=keys.evm;cleanup=()=>keys.sol.secretKey.fill(0);}
  try{
   if(signer.address.toLowerCase()!==request.context.rules!.approver.toLowerCase())throw Error('Selected vault is not the designated separate approver.');
   const signature=await signer.signTypedData(rulesDomain(request.context),PAYMENT_APPROVAL_TYPES,request.payment);
   if(verifyTypedData(rulesDomain(request.context),PAYMENT_APPROVAL_TYPES,request.payment,signature)!==signer.address)throw Error('Approval signature verification failed.');
   await assertOfflineEnvironment();
   if(paymentApprovalFingerprint(validateRulesApproval(await readJsonFile(directory,'rules-payment-approval.json')))!==fingerprint)throw Error('Payment changed during signing.');
   const response={kind:'drivekey-rules-payment-signature',version:1,request,fingerprint,signature,signedAt:new Date().toISOString()};
   await writeJsonFile(directory,`rules-approved-${fingerprint.slice(2)}.json`,response,true);
   await writeJsonFile(directory,'rules-signed-payment-approval.json',response,true);
   return {fingerprint,message:'Payment approval signed—awaiting application. No funds sent.'};
  }finally{cleanup();}
 }
 const context=rulesContextSchema.parse(await readJsonFile(directory,RULES_FILES.context));
 const raw=await readJsonFile(directory,c.profile==='eth'?'vault-encrypted.json':'vault-multi-encrypted.json');
 const vault=c.profile==='eth'?validateVault(raw):multiVaultSchema.parse(raw);
 const owner='address' in vault.public?vault.public.address:vault.public.evmAddress;
 if(owner.toLowerCase()!==context.owner.toLowerCase())throw Error('Account owner does not match selected vault.');
 if(c.action==='context'){
  let draft=null;
  try{const saved=validateRulesDraft(await readJsonFile(directory,RULES_FILES.draft),Date.now(),false);if(JSON.stringify(saved.context)===JSON.stringify(context))draft=saved;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return {context,draft,message:'Last reported online '+context.reportedAt+'. This is an imported observation.'};
 }
 if(c.action==='save'){
  const d=validateRulesDraft(c.draft);
  if(JSON.stringify(d.context)!==JSON.stringify(context))throw Error('Imported context changed.');
  await writeJsonFile(directory,RULES_FILES.draft,d,true);
  return {draft:d,message:'Local draft saved. No spending authority changed.'};
 }
 const d=validateRulesDraft(await readJsonFile(directory,RULES_FILES.draft));
 if(JSON.stringify(d.context)!==JSON.stringify(context))throw Error('Context changed. Review again.');
 const fingerprint=policyFingerprint(d);
 if(c.action==='review')return {draft:d,fingerprint,changes:rulesChanges(context.rules,d.rules),exposure:rulesExposure(d.rules),explanation:[rulesExplanation(d.rules,'eth'),rulesExplanation(d.rules,'usdg')],message:'Review every resulting permission. Approval and passphrase signing are separate steps.'};
 if(c.fingerprint!==fingerprint)throw Error('Rules changed since review.');
 let signer:Wallet,cleanup=()=>{};
 if(c.profile==='eth'){
  const v=validateVault(raw);const key=await decryptKeystoreJson(JSON.stringify(v.keystore),c.password);signer=new Wallet(key.privateKey);
 } else {const keys=await unlockMultiVault(multiVaultSchema.parse(raw),c.password);signer=keys.evm;cleanup=()=>keys.sol.secretKey.fill(0);}
 try{
  if(signer.address.toLowerCase()!==context.owner.toLowerCase())throw Error('Vault identity mismatch.');
  const signed=verifySignedRules({kind:'drivekey-rules-authorization',version:1,draft:d,fingerprint,signature:await signer.signTypedData(rulesDomain(context),POLICY_TYPES,policyMessage(d)),signedAt:new Date().toISOString()});
  await assertOfflineEnvironment();
  if(policyFingerprint(validateRulesDraft(await readJsonFile(directory,RULES_FILES.draft)))!==fingerprint||JSON.stringify(rulesContextSchema.parse(await readJsonFile(directory,RULES_FILES.context)))!==JSON.stringify(context))throw Error('Files changed during signing.');
  // Content-addressed recovery copy is never discarded when exporting a later authorization.
  const recovery=`rules-signed-${fingerprint.slice(2)}.json`;
  await writeJsonFile(directory,recovery,signed,true);
  await writeJsonFile(directory,RULES_FILES.signed,signed,true);
  return {fingerprint,message:'Signed—awaiting application. Import online, verify, then explicitly click Apply.'};
 }finally{cleanup();}
}
