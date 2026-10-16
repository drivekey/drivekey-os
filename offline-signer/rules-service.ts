// Broker only: bounded encrypted/public files. Never decrypts or signs in process.
import {z} from 'zod';
import {getAddress} from 'ethers';
import {safeDirectory} from '../core/files';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseLifecycleVault} from './lifecycle-isolation';
import {parseRulesBytes,isolatedRulesSignature} from './rules-isolation';
import {encodeRulesPublic,type RulesPurpose} from './rules-boundary-codec';
import {validateRulesSigningRequest} from './rules-validation';
import {RULES_FILES,rulesContextSchema,rulesDraftSchema,validateRulesDraft,policyFingerprint,verifySignedRules,rulesChanges,rulesExplanation,validateRulesApproval,paymentApprovalFingerprint,verifySignedRulesPayment,rulesExposure} from '../core/rules-protocol';
const base={scope:z.literal('rules'),profile:z.enum(['eth','multi'])};
const command=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('context')}).strict(),z.object({...base,action:z.literal('save'),draft:rulesDraftSchema}).strict(),z.object({...base,action:z.literal('review')}).strict(),
 z.object({...base,action:z.literal('sign'),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/i),consent:z.literal(true),password:z.string().max(256)}).strict(),
 z.object({...base,action:z.literal('inspect-approval')}).strict(),z.object({...base,action:z.literal('sign-approval'),fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/i),consent:z.literal(true),password:z.string().max(256)}).strict(),
]);
const serialized=(v:unknown)=>Buffer.from(JSON.stringify(v,null,2)+'\n');
export async function rulesOfflineAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();await safeDirectory(directory);
 const snapshots=new Map<string,Buffer>();
 async function read(name:string,purpose:RulesPurpose){const bytes=await readBoundedExchangeBytes(directory,name);snapshots.set(name,bytes);return parseRulesBytes(purpose,bytes);}
 async function vault(){const name=c.profile==='eth'?'vault-encrypted.json':'vault-multi-encrypted.json',bytes=await readBoundedExchangeBytes(directory,name);snapshots.set(name,bytes);return parseLifecycleVault(c.profile==='eth'?'v2':'v3',bytes);}
 async function unchanged(){for(const [name,bytes]of snapshots)if(!bytes.equals(await readBoundedExchangeBytes(directory,name)))throw Error('Rules input changed during operation.');await assertOfflineEnvironment();}
 const sameContext=(a:unknown,b:unknown)=>encodeRulesPublic('rules-context',a).equals(encodeRulesPublic('rules-context',b));
 if(c.action==='inspect-approval'||c.action==='sign-approval'){
  const request=validateRulesApproval(await read('rules-payment-approval.json','rules-approval'));validateRulesSigningRequest('payment',request);await unchanged();validateRulesSigningRequest('payment',request);
  const fingerprint=paymentApprovalFingerprint(request);
  if(c.action==='inspect-approval')return{approval:request,fingerprint,message:'Last reported online '+request.context.reportedAt+'. Approving this exact payment does not bypass current hard caps.'};
  if(c.fingerprint!==fingerprint)throw Error('Payment changed since review.');
  const v=await vault(),address=v.version===2?v.public.address:v.public.evmAddress;
  if(getAddress(address)!==getAddress(request.context.rules!.approver))throw Error('Selected vault is not the designated separate approver.');
  await unchanged();validateRulesSigningRequest('payment',request);
  const signature=await isolatedRulesSignature('payment',c.profile,request,v,c.fingerprint,c.password);
  await unchanged();validateRulesSigningRequest('payment',request);
  const response=verifySignedRulesPayment({kind:'drivekey-rules-payment-signature',version:1,request,...signature});
  // Recovery first; a later failure preserves it and must never report success.
  await writeBoundedExchangeBytes(directory,`rules-approved-${fingerprint.slice(2)}.json`,serialized(response));
  await unchanged();verifySignedRulesPayment(response);
  await writeBoundedExchangeBytes(directory,'rules-signed-payment-approval.json',serialized(response));
  await unchanged();verifySignedRulesPayment(response);
  return{fingerprint,message:'Payment approval signed—awaiting application. No funds sent.'};
 }
 const context=rulesContextSchema.parse(await read(RULES_FILES.context,'rules-context')),v=await vault(),owner=v.version===2?v.public.address:v.public.evmAddress;
 if(getAddress(owner)!==getAddress(context.owner))throw Error('Account owner does not match selected vault.');
 if(c.action==='context'){
  let draft=null;try{const saved=validateRulesDraft(await read(RULES_FILES.draft,'rules-draft'),Date.now(),false);if(sameContext(saved.context,context))draft=saved;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await unchanged();return{context,draft,message:'Last reported online '+context.reportedAt+'. This is an imported observation.'};
 }
 if(c.action==='save'){
  const d=validateRulesDraft(await parseRulesBytes('rules-draft',serialized(c.draft)));if(!sameContext(d.context,context))throw Error('Imported context changed.');
  await unchanged();validateRulesDraft(d);await writeBoundedExchangeBytes(directory,RULES_FILES.draft,serialized(d));await unchanged();validateRulesDraft(d);
  return{draft:d,message:'Local draft saved. No spending authority changed.'};
 }
 const d=validateRulesDraft(await read(RULES_FILES.draft,'rules-draft'));if(!sameContext(d.context,context))throw Error('Context changed. Review again.');
 await unchanged();validateRulesDraft(d);const fingerprint=policyFingerprint(d);
 if(c.action==='review')return{draft:d,fingerprint,changes:rulesChanges(context.rules,d.rules),exposure:rulesExposure(d.rules),explanation:[rulesExplanation(d.rules,'eth'),rulesExplanation(d.rules,'usdg')],message:'Review every resulting permission. Approval and passphrase signing are separate steps.'};
 if(c.fingerprint!==fingerprint)throw Error('Rules changed since review.');
 const signature=await isolatedRulesSignature('policy',c.profile,d,v,c.fingerprint,c.password);
 await unchanged();const signed=verifySignedRules({kind:'drivekey-rules-authorization',version:1,draft:d,...signature});
 await writeBoundedExchangeBytes(directory,`rules-signed-${fingerprint.slice(2)}.json`,serialized(signed));
 await unchanged();verifySignedRules(signed);
 await writeBoundedExchangeBytes(directory,RULES_FILES.signed,serialized(signed));
 await unchanged();verifySignedRules(signed);
 return{fingerprint,message:'Signed—awaiting application. Import online, verify, then explicitly click Apply.'};
}
