// Fixed typed wire format. No JSON, caller-chosen signing types or opaque hashes.
import {createHash} from 'node:crypto';
import {rulesContextSchema,rulesDraftSchema,rulesApprovalRequestSchema,type RulesBundle,type RulesContext,type RulesDraft} from '../core/rules-protocol';
import {lifecycleVaultFrame,decodeLifecycleVault,type LifecycleVault} from './lifecycle-boundary-codec';
export type RulesPurpose='rules-context'|'rules-draft'|'rules-approval';
export type RulesOperation='policy'|'payment';
export type RulesProfile='eth'|'multi';
export const RULES_PUBLIC_MAX=32768,RULES_COMMAND_MAX=32768,RULES_RESPONSE_MAX=512;
const purposes:RulesPurpose[]=['rules-context','rules-draft','rules-approval'];
class Writer{
 parts:Buffer[]=[];
 bytes(b:Uint8Array){this.parts.push(Buffer.from(b));}
 byte(n:number){this.bytes(Buffer.from([n]));}
 count(n:number){const b=Buffer.alloc(8);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid counter');b.writeBigUInt64BE(BigInt(n));this.bytes(b);}
 field(b:Uint8Array,max:number){if(b.length>max||b.length>65535)throw Error('Field exceeds limit');const n=Buffer.alloc(2);n.writeUInt16BE(b.length);this.bytes(n);this.bytes(b);}
 text(s:string,max:number){const b=Buffer.from(s,'utf8');try{if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b)!==s)throw Error('Lossy text');this.field(b,max);}finally{b.fill(0);}}
 finish(max:number){try{const b=Buffer.concat(this.parts);if(b.length>max){b.fill(0);throw Error('Frame exceeds limit');}return b;}finally{for(const b of this.parts)b.fill(0);}}
}
class Reader{
 at=0;constructor(readonly b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Frame exceeds limit');}
 bytes(n:number){if(n<0||this.at+n>this.b.length)throw Error('Truncated frame');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 byte(){return this.bytes(1)[0];}bool(){const n=this.byte();if(n>1)throw Error('Invalid flag');return n===1;}
 count(){const n=this.bytes(8).readBigUInt64BE();if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Counter overflow');return Number(n);}
 field(max:number){const n=this.bytes(2).readUInt16BE();if(n>max)throw Error('Field exceeds limit');return this.bytes(n);}
 text(max:number){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(this.field(max));}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s)))throw Error('Wrong frame purpose');}end(){if(this.at!==this.b.length)throw Error('Trailing frame data');}
}
type Limit=RulesBundle['eth'];
function putLimit(w:Writer,l:Limit){for(const v of [l.perPayment,l.rolling,l.sevenDay,l.thirtyDay,l.approvalAbove])w.text(v,39);w.count(l.count);}
function getLimit(r:Reader):Limit{return{perPayment:r.text(39),rolling:r.text(39),sevenDay:r.text(39),thirtyDay:r.text(39),approvalAbove:r.text(39),count:r.count()};}
function putBundle(w:Writer,b:RulesBundle){
 for(const v of [b.agent,b.approver,b.guardian])w.text(v,42);for(const v of [b.expires,b.weekdays,b.startMinute,b.endMinute,b.categories])w.count(v);w.byte(b.paused?1:0);putLimit(w,b.eth);putLimit(w,b.usdg);w.byte(b.recipients.length);
 for(const v of b.recipients){w.text(v.recipient,42);w.count(v.category);putLimit(w,v.eth);putLimit(w,v.usdg);}
}
function getBundle(r:Reader):RulesBundle{
 const b={agent:r.text(42),approver:r.text(42),guardian:r.text(42),expires:r.count(),weekdays:r.count(),startMinute:r.count(),endMinute:r.count(),categories:r.count(),paused:r.bool(),eth:getLimit(r),usdg:getLimit(r),recipients:[] as RulesBundle['recipients']};
 const count=r.byte();if(count>16)throw Error('Too many recipients');for(let i=0;i<count;i++)b.recipients.push({recipient:r.text(42),category:r.count(),eth:getLimit(r),usdg:getLimit(r)});return b;
}
function putContext(w:Writer,c:RulesContext){
 for(const v of [c.account,c.registry,c.owner])w.text(v,42);w.count(c.safetyEpoch);w.count(c.revision);
 for(const v of [c.policyHash,c.accountCodeHash,c.registryCodeHash])w.text(v,66);w.text(c.usdg,42);w.text(c.reportedAt,4096);w.count(c.blockNumber);w.text(c.blockHash,66);w.byte(c.paused?1:0);w.byte(c.rules?1:0);if(c.rules)putBundle(w,c.rules);
}
function getContext(r:Reader):RulesContext{
 return rulesContextSchema.parse({kind:'drivekey-rules-context',version:1,chainId:4663,contractVersion:4,ownerEpoch:1,account:r.text(42),registry:r.text(42),owner:r.text(42),safetyEpoch:r.count(),revision:r.count(),policyHash:r.text(66),accountCodeHash:r.text(66),registryCodeHash:r.text(66),usdg:r.text(42),reportedAt:r.text(4096),blockNumber:r.count(),blockHash:r.text(66),paused:r.bool(),rules:r.bool()?getBundle(r):null});
}
export function encodeRulesPublic(purpose:RulesPurpose,input:unknown){
 const tag=purposes.indexOf(purpose);if(tag<0)throw Error('Unsupported rules purpose');
 const w=new Writer();w.bytes(Buffer.from('DKRLSP01'));w.byte(tag);
 if(purpose==='rules-context')putContext(w,rulesContextSchema.parse(input));
 else if(purpose==='rules-draft'){
  const d=rulesDraftSchema.parse(input);putContext(w,d.context);putBundle(w,d.rules);w.count(d.authorizationExpiry);
  const labels=Object.entries(d.labels);if(labels.length>768)throw Error('Too many labels');w.count(labels.length);for(const [key,value]of labels){w.text(key,42);w.text(value,320);}
 }else{
  const a=rulesApprovalRequestSchema.parse(input),p=a.payment;putContext(w,a.context);w.text(p.paymentId,66);w.text(p.asset,42);w.text(p.recipient,42);w.text(p.amount,39);for(const v of [p.category,p.revision,p.safetyEpoch,p.expiry])w.count(v);
 }
 return w.finish(RULES_PUBLIC_MAX);
}
export function decodeRulesPublic(purpose:RulesPurpose,frame:Buffer):RulesContext|RulesDraft|ReturnType<typeof rulesApprovalRequestSchema.parse>{
 const r=new Reader(frame,RULES_PUBLIC_MAX);r.magic('DKRLSP01');if(r.byte()!==purposes.indexOf(purpose)||!purposes.includes(purpose))throw Error('Wrong rules purpose');
 let result:RulesContext|RulesDraft|ReturnType<typeof rulesApprovalRequestSchema.parse>;
 if(purpose==='rules-context')result=getContext(r);
 else if(purpose==='rules-draft'){
  const context=getContext(r),rules=getBundle(r),authorizationExpiry=r.count(),count=r.count();if(count>768)throw Error('Too many labels');const labels:Record<string,string>=Object.create(null);
  for(let i=0;i<count;i++){const key=r.text(42);if(Object.hasOwn(labels,key))throw Error('Duplicate label');labels[key]=r.text(320);}
  result=rulesDraftSchema.parse({kind:'drivekey-rules-draft',version:1,context,rules,authorizationExpiry,labels});
 }else result=rulesApprovalRequestSchema.parse({kind:'drivekey-rules-payment-approval',version:1,context:getContext(r),payment:{paymentId:r.text(66),asset:r.text(42),recipient:r.text(42),amount:r.text(39),category:r.count(),revision:r.count(),safetyEpoch:r.count(),expiry:r.count()}});
 r.end();return result;
}
function tags(operation:RulesOperation,profile:RulesProfile){if(!['policy','payment'].includes(operation)||!['eth','multi'].includes(profile))throw Error('Unsupported rules signing purpose');return Buffer.from([operation==='policy'?0:1,profile==='eth'?0:1]);}
function keyRequest(operation:RulesOperation,request:unknown){
 // Display labels are preserved in public review/export, but are not an EIP-712
 // authority field. They never enter the secret process or change its signature.
 return operation==='policy'?{...rulesDraftSchema.parse(request),labels:{}}:rulesApprovalRequestSchema.parse(request);
}
export function rulesCommandBinding(operation:RulesOperation,profile:RulesProfile,request:unknown,vault:unknown,fingerprint:string){
 if(!/^0x[0-9a-f]{64}$/i.test(fingerprint))throw Error('Invalid fingerprint');
 const requestFrame=encodeRulesPublic(operation==='policy'?'rules-draft':'rules-approval',keyRequest(operation,request)),vaultFrame=lifecycleVaultFrame(profile==='eth'?'v2':'v3',vault);
 return createHash('sha256').update('DriveKey rules boundary v1').update(tags(operation,profile)).update(requestFrame).update(vaultFrame).update(fingerprint).digest();
}
export function encodeRulesCommand(operation:RulesOperation,profile:RulesProfile,request:unknown,vault:unknown,fingerprint:string,password:string){
 if(typeof password!=='string'||password.length>256)throw Error('Invalid password bounds');const w=new Writer();w.bytes(Buffer.from('DKRLSK01'));w.bytes(tags(operation,profile));w.bytes(rulesCommandBinding(operation,profile,request,vault,fingerprint));w.text(fingerprint,66);
 w.field(encodeRulesPublic(operation==='policy'?'rules-draft':'rules-approval',keyRequest(operation,request)),RULES_PUBLIC_MAX);w.field(lifecycleVaultFrame(profile==='eth'?'v2':'v3',vault),4608);w.text(password,1024);return w.finish(RULES_COMMAND_MAX);
}
export function decodeRulesCommand(frame:Buffer){
 const r=new Reader(frame,RULES_COMMAND_MAX);r.magic('DKRLSK01');const op=r.byte(),p=r.byte();if(op>1||p>1)throw Error('Unsupported rules signing purpose');const operation:RulesOperation=op?'payment':'policy',profile:RulesProfile=p?'multi':'eth',binding=Buffer.from(r.bytes(32)),fingerprint=r.text(66);
 const request=decodeRulesPublic(operation==='policy'?'rules-draft':'rules-approval',r.field(RULES_PUBLIC_MAX)),vault=decodeLifecycleVault(profile==='eth'?'v2':'v3',r.field(4608)),password=r.text(1024);r.end();
 if(operation==='policy'&&Object.keys(rulesDraftSchema.parse(request).labels).length)throw Error('Display labels are not a key command field');
 if(password.length>256||!binding.equals(rulesCommandBinding(operation,profile,request,vault,fingerprint)))throw Error('Rules command binding mismatch');return{operation,profile,binding,fingerprint,request,vault,password};
}
export function encodeRulesResult(binding:Buffer,fingerprint:string,signature:string,signedAt:string){
 if(binding.length!==32||!/^0x[0-9a-f]{64}$/i.test(fingerprint)||!/^0x[0-9a-f]{128}(1b|1c)$/i.test(signature)||!Number.isFinite(Date.parse(signedAt)))throw Error('Invalid rules response');
 const w=new Writer();w.bytes(Buffer.from('DKRLSR01'));w.bytes(binding);w.text(fingerprint,66);w.text(signature,132);w.text(signedAt,64);return w.finish(RULES_RESPONSE_MAX);
}
export function decodeRulesResult(frame:Buffer,binding:Buffer,fingerprint:string){
 const r=new Reader(frame,RULES_RESPONSE_MAX);r.magic('DKRLSR01');if(!r.bytes(32).equals(binding))throw Error('Rules response binding mismatch');const f=r.text(66),signature=r.text(132),signedAt=r.text(64);r.end();
 if(f!==fingerprint)throw Error('Rules response fingerprint mismatch');encodeRulesResult(binding,f,signature,signedAt);return{fingerprint:f,signature,signedAt};
}
export type {LifecycleVault};
