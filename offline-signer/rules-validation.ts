// Public, fixed rules semantics shared by broker and independent key worker.
import {validateRulesDraft,validateRulesApproval} from '../core/rules-protocol';
export function validateRulesSigningRequest(operation:'policy'|'payment',input:unknown){
 if(operation==='policy')return validateRulesDraft(input);
 const a=validateRulesApproval(input);
 // A legitimate v4 contract cannot have overlapping owner/agent/approver/guardian.
 validateRulesDraft({kind:'drivekey-rules-draft',version:1,context:a.context,rules:a.context.rules,authorizationExpiry:a.payment.expiry,labels:{}});
 return a;
}
