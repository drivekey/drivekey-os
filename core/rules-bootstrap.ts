import 'server-only';
import {dirname,basename,isAbsolute,resolve} from 'node:path';
import {Interface,JsonRpcProvider,Wallet,getAddress,ZeroAddress} from 'ethers';
import {z} from 'zod';
import {readJsonFile} from './files';
import {checkRulesDeployment,RulesExecutor,RULES_ACCOUNT_ABI,type RulesDeployment,type RulesSigner} from './rules-executor';
import {installRulesRuntime,rulesRuntime,type RulesRuntime} from './rules-online';

const address=z.string().transform(v=>getAddress(v)).refine(v=>v!==ZeroAddress);
const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const file=z.string().refine(isAbsolute,'An absolute local path is required.');
const positive=z.string().max(24).regex(/^[1-9][0-9]*$/);
const role=z.object({address,keystore:file}).strict();
export const rulesPrivateConfigSchema=z.object({
 version:z.literal(1),chainId:z.literal(4663),account:address,registry:address,owner:address,approver:address,
 accountCodeHash:hash,registryCodeHash:hash,journalDirectory:file,
 maxFeePerGas:positive,maxGas:positive,maxTotalFee:positive,
 relayer:role,agent:role,guardian:role,
}).strict().superRefine((c,ctx)=>{
 const roles=[c.owner,c.approver,c.relayer.address,c.agent.address,c.guardian.address];
 if(new Set(roles.map(v=>v.toLowerCase())).size!==roles.length)ctx.addIssue({code:'custom',message:'Owner, approver, relayer, agent and guardian must be distinct.'});
 if(c.account===c.registry||roles.includes(c.account)||roles.includes(c.registry))ctx.addIssue({code:'custom',message:'Contracts must be separate from all wallet roles.'});
 if(new Set([c.relayer,c.agent,c.guardian].map(r=>resolve(r.keystore).toLowerCase())).size!==3)ctx.addIssue({code:'custom',message:'Each restricted signer needs a separate encrypted keystore.'});
 if(BigInt(c.maxGas)>2_000_000n||BigInt(c.maxFeePerGas)>100_000_000_000n||BigInt(c.maxTotalFee)>1_000_000_000_000_000n)ctx.addIssue({code:'custom',message:'Private companion fee ceilings exceed the supported bounds.'});
});
type Env=Record<string,string|undefined>;
type Dependencies={
 readConfig:(path:string)=>Promise<unknown>;
 provider:(url:string)=>JsonRpcProvider;
 signer:(path:string,password:string)=>Promise<RulesSigner>;
 verify:typeof checkRulesDeployment;
 install:(runtime:RulesRuntime)=>void;
};
async function readLocal(path:string){if(!isAbsolute(path))throw Error();return readJsonFile(dirname(path),basename(path));}
const defaults:Dependencies={
 readConfig:readLocal,
 provider:url=>new JsonRpcProvider(url,undefined,{batchMaxCount:1}),
 signer:async(path,password)=>Wallet.fromEncryptedJson(JSON.stringify(await readLocal(path)),password),
 verify:checkRulesDeployment,
 install:installRulesRuntime,
};
/** Startup only: reads and verifies; never signs, creates an account or submits a transaction. */
export async function bootstrapPrivateRules(env:Env=process.env,deps:Dependencies=defaults){
 if(!env.DRIVEKEY_RULES_CONFIG)return {configured:false as const};
 let provider:JsonRpcProvider|undefined;
 try{
  if(env.DRIVEKEY_PRIVATE_COMPANION!=='1'||env.VERCEL)throw Error();
  const endpoint=env.ROBINHOOD_RPC_URL;if(!endpoint)throw Error();
  const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error();
  const c=rulesPrivateConfigSchema.parse(await deps.readConfig(env.DRIVEKEY_RULES_CONFIG));
  const agentCredential=env.DRIVEKEY_AGENT_CREDENTIAL,operatorCredential=env.DRIVEKEY_OPERATOR_CREDENTIAL;
  if(!agentCredential||!operatorCredential||agentCredential===operatorCredential||![agentCredential,operatorCredential].every(v=>/^[-_a-zA-Z0-9]{43,128}$/.test(v)))throw Error();
  const names=['relayer','agent','guardian'] as const;
  const passwords=names.map(name=>env['DRIVEKEY_'+name.toUpperCase()+'_KEYSTORE_PASSWORD']);
  if(passwords.some(p=>!p||p.length<12||p.length>1024))throw Error();
  provider=deps.provider(endpoint);
  const iface=new Interface(RULES_ACCOUNT_ABI),executors:RulesExecutor[]=[];
  for(const [index,name] of names.entries()){
   const selectors=name==='relayer'?['applyPolicy']:name==='agent'?['requestPayment','executeApproved']:['stop'];
   const pins:RulesDeployment={account:c.account,registry:c.registry,owner:c.owner,accountCodeHash:c.accountCodeHash,registryCodeHash:c.registryCodeHash,signer:c[name].address,signerRole:name,maxFeePerGas:BigInt(c.maxFeePerGas),maxGas:BigInt(c.maxGas),maxTotalFee:BigInt(c.maxTotalFee),allowedSelectors:selectors.map(n=>iface.getFunction(n)!.selector)};
   const account=await deps.verify(provider,pins);
   if(getAddress(await account.approver())!==c.approver||getAddress(await account.agent())!==c.agent.address||getAddress(await account.guardian())!==c.guardian.address)throw Error();
   const signer=await deps.signer(c[name].keystore,passwords[index]!);
   if(getAddress(await signer.getAddress())!==c[name].address)throw Error();
   executors.push(new RulesExecutor(c.journalDirectory,provider,pins,signer));
  }
  deps.install({executor:executors[0],agentExecutor:executors[1],guardianExecutor:executors[2],agentCredential,operatorCredential});
  return {configured:true as const,account:c.account};
 }catch{
  provider?.destroy();
  // Upstream errors may contain credential-bearing URLs or keystore content.
  throw Error('Private agent companion configuration did not verify. Check encrypted signers, distinct roles, deployment pins, credentials and RPC. No transaction was submitted.');
 }
}
export async function initializePrivateRules(){if(!rulesRuntime())await bootstrapPrivateRules();}
