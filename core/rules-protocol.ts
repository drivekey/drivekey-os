import {z} from 'zod';
import {AbiCoder, getAddress, keccak256, TypedDataEncoder, verifyTypedData, ZeroHash, ZeroAddress, parseUnits, formatUnits} from 'ethers';
import {ROBINHOOD_USDG_IDENTITY} from './robinhood-proxy-identity';
const address=z.string().refine(v=>{try{return getAddress(v)!==ZeroAddress;}catch{return false;}},'Invalid address');
const hash=z.string().regex(/^0x[0-9a-f]{64}$/i);
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/).refine(v=>BigInt(v)<2n**128n,'Amount overflow');
const counter=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const rulesLimitSchema=z.object({perPayment:uint,rolling:uint,sevenDay:uint,thirtyDay:uint,approvalAbove:uint,count:z.number().int().min(0).max(4294967295)}).strict();
export const rulesBundleSchema=z.object({agent:address,approver:address,guardian:address,expires:counter,weekdays:z.number().int().min(1).max(127),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),categories:z.number().int().min(0).max(511),paused:z.boolean(),eth:rulesLimitSchema,usdg:rulesLimitSchema,recipients:z.array(z.object({recipient:address,category:z.number().int().min(0).max(8),eth:rulesLimitSchema,usdg:rulesLimitSchema}).strict()).max(16)}).strict().superRefine((b,c)=>{
 if(b.startMinute>=b.endMinute)c.addIssue({code:'custom',message:'UTC end must follow start'});
 if(new Set(b.recipients.map(r=>r.recipient.toLowerCase())).size!==b.recipients.length)c.addIssue({code:'custom',message:'Duplicate recipient'});
});
export type RulesBundle=z.infer<typeof rulesBundleSchema>;
export const rulesContextSchema=z.object({kind:z.literal('drivekey-rules-context'),version:z.literal(1),chainId:z.literal(4663),contractVersion:z.literal(4),account:address,registry:address,owner:address,ownerEpoch:z.literal(1),safetyEpoch:counter,revision:counter,policyHash:hash,accountCodeHash:hash,registryCodeHash:hash,usdg:z.literal(ROBINHOOD_USDG_IDENTITY.token),reportedAt:z.string().datetime(),blockNumber:counter,blockHash:hash,paused:z.boolean(),rules:rulesBundleSchema.nullable()}).strict();
export type RulesContext=z.infer<typeof rulesContextSchema>;
export const rulesDraftSchema=z.object({kind:z.literal('drivekey-rules-draft'),version:z.literal(1),context:rulesContextSchema,rules:rulesBundleSchema,authorizationExpiry:counter,labels:z.record(address,z.string().max(80)).default({})}).strict();
export type RulesDraft=z.infer<typeof rulesDraftSchema>;
export const RULES_FILES={context:'rules-account-context.json',draft:'rules-local-draft.json',signed:'rules-signed-authorization.json',evidence:'rules-application-evidence.json'} as const;
export const PAYMENT_APPROVAL_TYPES={PaymentApproval:[{name:'paymentId',type:'bytes32'},{name:'asset',type:'address'},{name:'recipient',type:'address'},{name:'amount',type:'uint256'},{name:'category',type:'uint8'},{name:'revision',type:'uint256'},{name:'safetyEpoch',type:'uint256'},{name:'expiry',type:'uint256'}]};
export const rulesPaymentSchema=z.object({paymentId:hash,asset:z.enum([ZeroAddress,ROBINHOOD_USDG_IDENTITY.token]),recipient:address,amount:uint.refine(v=>BigInt(v)>0n),category:z.number().int().min(0).max(8),revision:counter,safetyEpoch:counter,expiry:counter}).strict();
export const rulesApprovalRequestSchema=z.object({kind:z.literal('drivekey-rules-payment-approval'),version:z.literal(1),context:rulesContextSchema,payment:rulesPaymentSchema}).strict();
export function validateRulesApproval(input:unknown,now=Date.now()){
 const r=rulesApprovalRequestSchema.parse(input),p=r.payment,c=r.context;
 if(!c.rules||c.paused||c.rules.paused||c.revision!==p.revision||c.safetyEpoch!==p.safetyEpoch||rulesHash(c.rules)!==c.policyHash||p.expiry>c.rules.expires||p.expiry<=Math.floor(now/1000))throw Error('Stale or invalid payment approval.');
 const asset=p.asset===ZeroAddress?'eth':'usdg',recipient=c.rules.recipients.find(x=>x.recipient.toLowerCase()===p.recipient.toLowerCase()&&x.category===p.category);
 if(!recipient||!(c.rules.categories&(1<<p.category))||BigInt(p.amount)>BigInt(c.rules[asset].perPayment)||BigInt(p.amount)>BigInt(recipient[asset].perPayment))throw Error('Payment violates reported hard caps or recipient restrictions.');
 return r;
}
export function paymentApprovalFingerprint(r:z.infer<typeof rulesApprovalRequestSchema>){return TypedDataEncoder.hash(rulesDomain(r.context),PAYMENT_APPROVAL_TYPES,r.payment);}
export const signedRulesPaymentSchema=z.object({kind:z.literal('drivekey-rules-payment-signature'),version:z.literal(1),request:rulesApprovalRequestSchema,fingerprint:hash,signature:z.string().regex(/^0x[0-9a-f]{128}(1b|1c)$/i),signedAt:z.string().datetime()}).strict();
export function verifySignedRulesPayment(input:unknown,now=Date.now()){
 const s=signedRulesPaymentSchema.parse(input),r=validateRulesApproval(s.request,now);
 if(s.fingerprint!==paymentApprovalFingerprint(r)||verifyTypedData(rulesDomain(r.context),PAYMENT_APPROVAL_TYPES,r.payment,s.signature).toLowerCase()!==r.context.rules!.approver.toLowerCase())throw Error('Payment approver signature mismatch.');
 return s;
}
const limit='tuple(uint128 perPayment,uint128 rolling,uint128 sevenDay,uint128 thirtyDay,uint128 approvalAbove,uint32 count)';
export const RULES_ABI=`tuple(address agent,address approver,address guardian,uint64 expires,uint8 weekdays,uint16 startMinute,uint16 endMinute,uint16 categories,bool paused,${limit} eth,${limit} usdg,tuple(address recipient,uint8 category,${limit} eth,${limit} usdg)[] recipients)`;
export function encodeRules(r:RulesBundle){return AbiCoder.defaultAbiCoder().encode([RULES_ABI],[rulesBundleSchema.parse(r)]);}
export function rulesHash(r:RulesBundle){return keccak256(encodeRules(r));}
export const POLICY_TYPES={PolicyAuthorization:[{name:'registry',type:'address'},{name:'contractVersion',type:'uint256'},{name:'ownerEpoch',type:'uint256'},{name:'safetyEpoch',type:'uint256'},{name:'expectedRevision',type:'uint256'},{name:'expectedHash',type:'bytes32'},{name:'newRulesHash',type:'bytes32'},{name:'authorizationExpiry',type:'uint256'}]};
export function rulesDomain(c:RulesContext){return {name:'DriveKey Rules',version:'4',chainId:4663,verifyingContract:c.account};}
export function policyMessage(d:RulesDraft){const c=d.context;return {registry:c.registry,contractVersion:4,ownerEpoch:c.ownerEpoch,safetyEpoch:c.safetyEpoch,expectedRevision:c.revision,expectedHash:c.policyHash,newRulesHash:rulesHash(d.rules),authorizationExpiry:d.authorizationExpiry};}
export function validateRulesDraft(input:unknown,now=Date.now(),fresh=true){
 const d=rulesDraftSchema.parse(input),c=d.context;
 if(new Set([c.owner,d.rules.agent,d.rules.approver,d.rules.guardian].map(a=>a.toLowerCase())).size!==4)throw Error('Owner, agent, approver and guardian must be distinct.');
 if(c.account.toLowerCase()===c.registry.toLowerCase()||d.rules.recipients.some(r=>r.recipient.toLowerCase()===c.account.toLowerCase()))throw Error('Invalid account/recipient identity.');
 if(c.rules ? rulesHash(c.rules)!==c.policyHash : c.revision!==0||c.policyHash!==ZeroHash)throw Error('Reported policy hash mismatch.');
 if(fresh&&(d.rules.expires<=Math.floor(now/1000)||d.authorizationExpiry<=Math.floor(now/1000)))throw Error('Rules or authorization expired.');
 if(d.authorizationExpiry>d.rules.expires)throw Error('Authorization must expire no later than rules.');
 return d;
}
export function policyFingerprint(d:RulesDraft){return TypedDataEncoder.hash(rulesDomain(d.context),POLICY_TYPES,policyMessage(d));}
export const signedRulesSchema=z.object({kind:z.literal('drivekey-rules-authorization'),version:z.literal(1),draft:rulesDraftSchema,fingerprint:hash,signature:z.string().regex(/^0x[0-9a-f]{128}(1b|1c)$/i),signedAt:z.string().datetime()}).strict();
export function verifySignedRules(input:unknown,now=Date.now()){
 const s=signedRulesSchema.parse(input),d=validateRulesDraft(s.draft,now);
 if(s.fingerprint!==policyFingerprint(d)||getAddress(verifyTypedData(rulesDomain(d.context),POLICY_TYPES,policyMessage(d),s.signature))!==getAddress(d.context.owner))throw Error('Owner signature mismatch.');
 return s;
}
export function exactRulesAmount(text:string,asset:'eth'|'usdg'){
 const decimals=asset==='eth'?18:6;
 if(!new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`).test(text))throw Error('Enter an exact nonnegative decimal amount.');
 return uint.parse(parseUnits(text,decimals).toString());
}
export function rulesExplanation(r:RulesBundle,asset:'eth'|'usdg'){
 const l=r[asset],decimals=asset==='eth'?18:6,symbol=asset.toUpperCase();
 return `This agent may send up to ${formatUnits(l.perPayment,decimals)} ${symbol} per payment and ${formatUnits(l.rolling,decimals)} ${symbol} within any 24 hours, only to these recipients. Payments above ${formatUnits(l.approvalAbove,decimals)} require offline approval.`;
}
export function rulesExposure(r:RulesBundle,now=Date.now()){
 const start=Math.floor(now/1000),end=r.expires,duration=Math.max(0,end-start);
 const windows=BigInt(Math.ceil(duration/86400));
 const periods=(seconds:number)=>BigInt(duration?Math.floor((end-1)/seconds)-Math.floor(start/seconds)+1:0);
 const min=(values:bigint[])=>values.reduce((a,b)=>a<b?a:b);
 const cap=(l:z.infer<typeof rulesLimitSchema>)=>min([BigInt(l.rolling)*windows,BigInt(l.perPayment)*BigInt(l.count)*windows,BigInt(l.sevenDay)*periods(7*86400),BigInt(l.thirtyDay)*periods(30*86400)]);
 return Object.fromEntries((['eth','usdg'] as const).map(asset=>{
  const recipients=r.recipients.filter(p=>r.categories&(1<<p.category)).reduce((n,p)=>n+cap(p[asset]),0n);
  const amount=r.paused?0n:min([cap(r[asset]),recipients]);
  return [asset,{baseUnits:amount.toString(),display:formatUnits(amount,asset==='eth'?18:6),label:'Maximum under hard caps until expiry, including payments approved separately offline. Actual capacity may be lower because of usage, schedule and account balance.'}];
 }));
}
export function rulesChanges(before:RulesBundle|null,after:RulesBundle){
 const rows:{field:string;before:unknown;after:unknown;expanded:boolean}[]=[];
 function walk(a:unknown,b:unknown,path:string){
  if(b!==null&&typeof b==='object'){for(const [k,v] of Object.entries(b))walk(a&&typeof a==='object'?(a as Record<string,unknown>)[k]:undefined,v,path?`${path}.${k}`:k);if(a&&typeof a==='object')for(const k of Object.keys(a))if(!(k in b))rows.push({field:`${path}.${k}`,before:(a as Record<string,unknown>)[k],after:null,expanded:true});return;}
  if(a!==b)rows.push({field:path,before:a??null,after:b,expanded:typeof b==='string'&&/^\d+$/.test(b)?BigInt(b)>BigInt(typeof a==='string'&&/^\d+$/.test(a)?a:'0'):true});
 }
 walk(before,after,'');return rows;
}
export function newRulesDraft(c:RulesContext,roles:{agent:string;approver:string;guardian:string},now=Date.now()):RulesDraft{
 const zero={perPayment:'0',rolling:'0',sevenDay:'0',thirtyDay:'0',approvalAbove:'0',count:0};
 return {kind:'drivekey-rules-draft',version:1,context:c,authorizationExpiry:Math.floor(now/1000)+86400,labels:{},rules:c.rules?structuredClone(c.rules):{...roles,expires:Math.floor(now/1000)+30*86400,weekdays:127,startMinute:0,endMinute:1440,categories:0,paused:true,eth:{...zero},usdg:{...zero},recipients:[]}};
}
