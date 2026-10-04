import {AbiCoder,Contract,Interface,JsonRpcProvider,ZeroHash,ZeroAddress,keccak256} from 'ethers';
import {RULES_ABI,rulesBundleSchema,rulesContextSchema,verifySignedRules,encodeRules,type RulesContext} from './rules-protocol';
import {checkRulesDeployment,RULES_ACCOUNT_ABI,type RulesDeployment,RulesExecutor} from './rules-executor';
import {resolve} from 'node:path';
export async function reportedRules(provider:JsonRpcProvider,pins:RulesDeployment){
 const account=await checkRulesDeployment(provider,pins),block=await provider.getBlock('latest');if(!block?.hash)throw Error('Missing block.');
 const at={blockTag:block.number},registry=new Contract(pins.registry,['function policy() view returns(bytes)','function usage(bytes32) view returns(uint256,uint256,uint256,uint256)'],provider);
 const [encoded,revision,policyHash,safetyEpoch,paused,ownerEpoch]=await Promise.all([registry.policy(at),account.revision(at),account.policyHash(at),account.safetyEpoch(at),account.paused(at),account.ownerEpoch(at)]);
 const decoded=encoded==='0x'?null:AbiCoder.defaultAbiCoder().decode([RULES_ABI],encoded)[0];
 const limit=(l:any)=>({perPayment:String(l.perPayment),rolling:String(l.rolling),sevenDay:String(l.sevenDay),thirtyDay:String(l.thirtyDay),approvalAbove:String(l.approvalAbove),count:Number(l.count)});
 const rules=decoded?rulesBundleSchema.parse({agent:decoded.agent,approver:decoded.approver,guardian:decoded.guardian,expires:Number(decoded.expires),weekdays:Number(decoded.weekdays),startMinute:Number(decoded.startMinute),endMinute:Number(decoded.endMinute),categories:Number(decoded.categories),paused:decoded.paused,eth:limit(decoded.eth),usdg:limit(decoded.usdg),recipients:decoded.recipients.map((r:any)=>({recipient:r.recipient,category:Number(r.category),eth:limit(r.eth),usdg:limit(r.usdg)}))}):null;
 const {ROBINHOOD_USDG_IDENTITY}=await import('./robinhood-proxy-identity');
 const context=rulesContextSchema.parse({kind:'drivekey-rules-context',version:1,chainId:4663,contractVersion:4,account:pins.account,registry:pins.registry,owner:pins.owner,ownerEpoch:Number(ownerEpoch),safetyEpoch:Number(safetyEpoch),revision:Number(revision),policyHash,accountCodeHash:pins.accountCodeHash,registryCodeHash:pins.registryCodeHash,usdg:ROBINHOOD_USDG_IDENTITY.token,reportedAt:new Date().toISOString(),blockNumber:block.number,blockHash:block.hash,paused,rules});
 const usage:Record<string,string[]>={};for(const asset of [ZeroAddress,context.usdg]){const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address'],[asset,ZeroAddress]));usage[asset]=(await registry.usage(key,at)).map(String);}
 if((await provider.getBlock(block.number))?.hash!==block.hash)throw Error('Context observation reorganized.');
 return {context,usage,gas:{signer:pins.signer,maxFeePerGas:pins.maxFeePerGas.toString(),maxGas:pins.maxGas.toString(),maxTotalFee:pins.maxTotalFee.toString()}};
}
export async function previewRulesApplication(input:unknown,provider:JsonRpcProvider,pins:RulesDeployment){
 const signed=verifySignedRules(input),current=await reportedRules(provider,pins),c=signed.draft.context,n=current.context;
 for(const k of ['account','registry','owner','accountCodeHash','registryCodeHash','revision','safetyEpoch','policyHash','ownerEpoch'] as const)if(String(c[k]).toLowerCase()!==String(n[k]).toLowerCase())throw Error('Imported authorization no longer matches '+k+'.');
 const data=new Interface(RULES_ACCOUNT_ABI).encodeFunctionData('applyPolicy',[encodeRules(signed.draft.rules),c.revision,c.policyHash,c.safetyEpoch,signed.draft.authorizationExpiry,signed.signature]);
 await provider.call({from:pins.signer,to:pins.account,data,value:0n});
 return {fingerprint:signed.fingerprint,simulation:'passed',current:current.context,expires:signed.draft.authorizationExpiry};
}
// A private companion supplies an independently verified, restricted gas signer.
// No owner-key loading or browser wallet signer is available here.
export type RulesRuntime={executor:RulesExecutor;agentExecutor:RulesExecutor;guardianExecutor:RulesExecutor;agentCredential:string;operatorCredential:string};
const runtimeKey=Symbol.for('drivekey.rules.private-runtime.v1');
export function installRulesRuntime(runtime:RulesRuntime){
 if(runtime.agentCredential===runtime.operatorCredential||runtime.agentCredential.length<32||runtime.operatorCredential.length<32)throw Error('Distinct strong credentials required.');
 if(runtime.executor.pins.signerRole!=='relayer'||runtime.agentExecutor.pins.signerRole!=='agent'||runtime.guardianExecutor.pins.signerRole!=='guardian')throw Error('Distinct restricted executors required.');
 for(const e of [runtime.agentExecutor,runtime.guardianExecutor])if(e.pins.account.toLowerCase()!==runtime.executor.pins.account.toLowerCase()||resolve(e.directory)!==resolve(runtime.executor.directory))throw Error('Executors must share account and durable journal.');
 const target=globalThis as unknown as Record<symbol,RulesRuntime>;if(target[runtimeKey])throw Error('Rules runtime already installed.');target[runtimeKey]=runtime;
}
export function rulesRuntime(){return (globalThis as unknown as Record<symbol,RulesRuntime|undefined>)[runtimeKey];}
