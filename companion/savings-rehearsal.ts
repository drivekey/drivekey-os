// LOCAL DEVELOPMENT ONLY. Explicit loopback Anvil, synthetic wallets and public
// transaction journals. Never a production relayer or trusted enrollment source.
import {z} from 'zod';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AbiCoder,Contract,JsonRpcProvider,Transaction,getAddress,getCreateAddress,keccak256} from 'ethers';
import {multiPublicSchema} from '../core/multi-protocol';
import {validateSavingsSetup,savingsSetupProgress} from '../core/savings-setup';
import {SAVINGS_ABI,savingsActionHash} from '../core/savings-protocol';
import {SAVINGS_V1_BUILD_IDENTITY,savingsV1CompilerInput,verifySavingsBuildArtifact,compareSavingsEnrollmentObservation,type SavingsBuildArtifact} from '../core/savings-enrollment';
import {prepareSavingsDeploymentTransaction,prepareSavingsRelayTransaction,reviewSavingsTransaction,verifySavingsTransactionResponse,savingsTransactionRequestSchema,savingsTransactionResponseSchema,type SavingsTransactionRequest} from '../core/savings-transaction';
import {prepareSavingsAction,savingsApprovalCollectionSchema} from '../core/savings-action-workflow';
import {savingsReviewExpectationSchema,savingsActionReviewRequestSchema} from '../core/savings-action-review';
import {inspectSavingsCall,compareSavingsCallObservation} from '../core/savings-lifecycle';
export const savingsRehearsalFlags={environment:'local-anvil-rehearsal',chainAuthenticated:false,independentlyEnrolled:false,fundingReady:false,productionReady:false} as const;
export function savingsRehearsalEndpoint(env:Record<string,string|undefined>=process.env){
 if(env.VERCEL||!['development','test'].includes(env.NODE_ENV??'')||!env.DRIVEKEY_SAVINGS_REHEARSAL_RPC)throw Error('Local Savings rehearsal is unavailable.');
 const u=new URL(env.DRIVEKEY_SAVINGS_REHEARSAL_RPC);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('A literal loopback Anvil endpoint is required.');return u.href;
}
let build:Promise<SavingsBuildArtifact>|undefined;
async function artifact(){return build??=(async()=>{const solc=(await import('solc')).default,source=await readFile(resolve('contracts/DriveKeySavingsV1.sol'),'utf8');
 const output=JSON.parse(solc.compile(JSON.stringify(savingsV1CompilerInput(source))));if((output.errors??[]).some((e:{severity:string})=>e.severity==='error'))throw Error('Pinned Savings compilation failed.');
 const c=output.contracts[SAVINGS_V1_BUILD_IDENTITY.sourcePath].DriveKeySavingsV1;
 return verifySavingsBuildArtifact({kind:'drivekey-savings-build',version:1,chainId:1,contract:'DriveKeySavingsV1',contractVersion:1,compiler:solc.version(),sourceHash:SAVINGS_V1_BUILD_IDENTITY.sourceHash,settingsHash:SAVINGS_V1_BUILD_IDENTITY.settingsHash,creationCode:'0x'+c.evm.bytecode.object,runtimeCode:'0x'+c.evm.deployedBytecode.object});})();}
async function identity(p:JsonRpcProvider,vault:string,blockNumber?:number){
 const b=blockNumber??Number(await p.send('eth_blockNumber',[])),c=new Contract(vault,SAVINGS_ABI,p),tag={blockTag:b};
 const [code,preset,signers,epoch,paused]=await Promise.all([p.getCode(vault,b),c.preset(tag),c.signers(tag),c.epoch(tag),c.paused(tag)]);
 if(keccak256(code)!==SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash)throw Error('Local deployed code differs from the pinned candidate.');
 return savingsReviewExpectationSchema.parse({kind:'drivekey-savings-review-expectation',version:1,chainId:1,contractVersion:1,vault,runtimeCodeHash:SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash,configuration:{preset:Number(preset),signers:[...signers].map(getAddress)},epoch:Number(epoch),paused});
}
const signedInput=z.object({request:savingsTransactionRequestSchema,response:savingsTransactionResponseSchema}).strict();
async function observe(p:JsonRpcProvider,r:SavingsTransactionRequest,response:z.infer<typeof savingsTransactionResponseSchema>){
 const receipt=await p.getTransactionReceipt(response.transactionHash),tx=await p.getTransaction(response.transactionHash);
 if(!receipt||!tx)return {status:'submission-uncertain',transactionHash:response.transactionHash,...savingsRehearsalFlags};
 if(Transaction.from(tx).serialized!==response.rawSignedTransaction)throw Error('Local transaction differs from signed bytes.');
 const block=await p.getBlock(receipt.blockNumber);if(!block||block.hash!==receipt.blockHash)return {status:'reconciliation-required',transactionHash:response.transactionHash,...savingsRehearsalFlags};
 if(receipt.status!==1)return {status:'reverted',transactionHash:response.transactionHash,...savingsRehearsalFlags};
 const at={number:receipt.blockNumber,hash:receipt.blockHash,timestamp:block.timestamp};
 if(r.operation.kind==='deploy'){
  const i=r.operation.intent,c=new Contract(i.expectedVault,SAVINGS_ABI,p),tag={blockTag:receipt.blockNumber};
  const atIdentity=await identity(p,i.expectedVault,receipt.blockNumber);
  const observation={kind:'drivekey-savings-enrollment-observation',version:1,provenance:'host-rpc',chainId:1,observedAt:new Date().toISOString(),
   receipt:{transactionHash:response.transactionHash,status:1,contractAddress:receipt.contractAddress,from:receipt.from,to:receipt.to,block:at},
   codeAt:{address:i.expectedVault,block:at,runtimeCode:await p.getCode(i.expectedVault,receipt.blockNumber)},
   stateAt:{address:i.expectedVault,block:at,configuration:atIdentity.configuration,configurationHash:await c.currentConfigHash(tag),epoch:atIdentity.epoch,paused:atIdentity.paused,
    threshold:Number(await c.threshold(tag)),withdrawalDelay:Number(await c.withdrawalDelay(tag)),securityDelay:Number(await c.SECURITY_DELAY(tag)),maxLifetime:Number(await c.MAX_LIFETIME(tag)),usdc:await c.USDC(tag),reportedChainId:1}};
  // Enrollment's block schema intentionally excludes timestamps.
  for(const section of [observation.receipt,observation.codeAt,observation.stateAt])section.block={number:at.number,hash:at.hash} as typeof at;
  compareSavingsEnrollmentObservation(await artifact(),i,{kind:'drivekey-savings-deployment-proposal',version:1,unsignedTransaction:r.unsignedTransaction},{kind:'drivekey-savings-signed-deployment',version:1,rawTransaction:response.rawSignedTransaction},observation);
  return {status:'local-vault-created',transactionHash:response.transactionHash,identity:await identity(p,i.expectedVault),...savingsRehearsalFlags};
 }
 const o=r.operation,op=o.request.operation,signatures=[...o.collection.authorizations].sort((a,b)=>BigInt(a.signer)<BigInt(b.signer)?-1:1).map(a=>a.signature);
 const operation=op.kind==='queue'?{kind:'queue',...op.details,approvals:signatures}:op.kind==='execute'?{kind:'execute',...op.details}:op.kind==='protect'?{kind:'protect',protection:op.protection,target:op.target?.action??null,approval:signatures[0]}:{kind:'cancel-configuration',protection:op.protection,target:op.target.action,approvals:signatures};
 const expected={kind:'drivekey-savings-call-expectation',version:1,chainId:1,vault:o.expectation.vault,configuration:o.expectation.configuration,epoch:o.expectation.epoch,paused:o.expectation.paused,operation,rawTransaction:response.rawSignedTransaction};
 inspectSavingsCall(expected);
 compareSavingsCallObservation(expected,{kind:'drivekey-savings-call-observation',version:1,provenance:'host-rpc',chainId:1,
  transaction:{rawTransaction:response.rawSignedTransaction,block:at,transactionIndex:receipt.index},receipt:{transactionHash:response.transactionHash,status:1,block:at,transactionIndex:receipt.index,
   // Receipt logs are not filter notifications: ethers can omit `removed`.
   // This flag is derived only after the receipt block was matched above to
   // the local node's canonical block. An explicit removal is still rejected
   // by the lifecycle reducer. This remains a host-RPC observation, not trust.
   logs:receipt.logs.map(l=>({address:l.address,topics:[...l.topics],data:l.data,logIndex:l.index,transactionHash:l.transactionHash,blockNumber:l.blockNumber,blockHash:l.blockHash,transactionIndex:l.transactionIndex,removed:l.removed??false}))},canonicalReceiptBlock:at});
 let queue:unknown=null;if(op.kind==='queue'){const c=new Contract(o.expectation.vault,SAVINGS_ABI,p),actionId=savingsActionHash(o.expectation.vault,op.details.action),pending=await c.pending(actionId);
  queue={provenance:'host-rpc',actionId,queuedAt:Number(pending.queuedAt),readyAt:Number(pending.readyAt),expiry:Number(pending.expiry),epoch:Number(pending.epoch),status:Number(pending.status)===1?'queued':'unavailable'};}
 return {status:op.kind==='queue'?'local-action-queued':'local-operation-observed',transactionHash:response.transactionHash,queue,identity:await identity(p,o.expectation.vault),...savingsRehearsalFlags};
}
/** Intent is written with exclusive creation before RPC. Existing/partial claims
 * always require reconciliation; neither retries nor fee replacement happen here. */
async function claim(r:SavingsTransactionRequest,response:z.infer<typeof savingsTransactionResponseSchema>){
 const dir=resolve('outputs/savings-local-journal');await mkdir(dir,{recursive:true});
 const path=resolve(dir,`${r.gasPayer.toLowerCase()}-${r.gas.nonce}.json`),f=await open(path,'wx',0o600);
 try{await f.writeFile(JSON.stringify({request:r,response,submissionAttempted:true,observation:null,...savingsRehearsalFlags}));await f.sync();}finally{await f.close();}
}
export async function savingsRehearsalAction(input:unknown,env:Record<string,string|undefined>=process.env){
 const endpoint=savingsRehearsalEndpoint(env),a=z.object({action:z.enum(['status','prepare-deployment','prepare-relay','submit','reconcile','prepare-execution']),input:z.unknown().optional()}).strict().parse(input);
 const p=new JsonRpcProvider(endpoint,1,{staticNetwork:true,cacheTimeout:-1});
 try{
  if(await p.send('eth_chainId',[])!=='0x1'||!/^anvil\//i.test(await p.send('web3_clientVersion',[])))throw Error('Expected the isolated local Anvil chain.');
  if(a.action==='status')return {available:true,...savingsRehearsalFlags};
  if(a.action==='prepare-relay'){
   const i=z.object({expectation:savingsReviewExpectationSchema,request:savingsActionReviewRequestSchema,collection:savingsApprovalCollectionSchema,wallet:multiPublicSchema}).strict().parse(a.input);
   if(JSON.stringify(await identity(p,i.expectation.vault))!==JSON.stringify(i.expectation))throw Error('Local vault policy changed. Reconcile the previous operation first.');
   const now=Date.now(),nonce=Number(await p.send('eth_getTransactionCount',[i.wallet.evmAddress,'pending']));
   const request=prepareSavingsRelayTransaction(i.expectation,i.request,i.collection,i.wallet.evmAddress,{nonce,gasLimit:'5000000',maxFeePerGas:'10000000000',maxPriorityFeePerGas:'100000000'},
    {requestId:crypto.randomUUID(),deviceId:i.wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+7200000).toISOString()},now);
   return {request,...savingsRehearsalFlags};
  }
  if(a.action==='prepare-deployment'){
   const i=z.object({setup:z.unknown(),proofs:z.array(z.unknown()).max(9),wallet:multiPublicSchema}).strict().parse(a.input),s=validateSavingsSetup(i.setup);
   if(!savingsSetupProgress(s,i.proofs).ceremonyVerified||s.spendingAccount!==i.wallet.evmAddress)throw Error('Complete this setup ceremony with the exact separate gas wallet first.');
   const art=await artifact(),nonce=Number(await p.send('eth_getTransactionCount',[i.wallet.evmAddress,'pending'])),configuration={preset:s.preset==='standard'?0:1,signers:[...s.signers].sort((x,y)=>BigInt(x)<BigInt(y)?-1:1)},gas={nonce,gasLimit:'5000000',maxFeePerGas:'10000000000',maxPriorityFeePerGas:'100000000'};
   const intent={kind:'drivekey-savings-enrollment-intent',version:1,chainId:1,contractVersion:1,mechanism:'direct-create',deployer:i.wallet.evmAddress,expectedVault:getCreateAddress({from:i.wallet.evmAddress,nonce}),configuration,...gas};
   const unsignedTransaction=Transaction.from({type:2,chainId:1,to:null,value:0,accessList:[],...gas,data:art.creationCode+AbiCoder.defaultAbiCoder().encode(['uint8','address[]'],[configuration.preset,configuration.signers]).slice(2)}).unsignedSerialized,now=Date.now();
   const request=prepareSavingsDeploymentTransaction(art,intent,{kind:'drivekey-savings-deployment-proposal',version:1,unsignedTransaction},{requestId:crypto.randomUUID(),deviceId:i.wallet.deviceId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+7200000).toISOString()},now);
   return {request,...savingsRehearsalFlags};
  }
  const {request:r,response:s}=signedInput.parse(a.input);verifySavingsTransactionResponse(s,r,a.action==='submit'?Date.now():Date.parse(s.signedAt));
  if(a.action==='submit'){
   reviewSavingsTransaction(r);if(r.operation.kind==='relay'){const current=await identity(p,r.operation.expectation.vault);if(JSON.stringify(current)!==JSON.stringify(r.operation.expectation))throw Error('Local vault policy changed. Start a fresh review.');}
   if(Number(await p.send('eth_getTransactionCount',[r.gasPayer,'pending']))!==r.gas.nonce)throw Error('Gas-wallet nonce changed. Reconcile earlier work first.');
   await claim(r,s);try{const hash=await p.send('eth_sendRawTransaction',[s.rawSignedTransaction]);if(hash!==s.transactionHash)throw Error('Submission hash differed.');}catch{return {status:'submission-uncertain',transactionHash:s.transactionHash,...savingsRehearsalFlags};}
  }
  const result=await observe(p,r,s);
  if(a.action==='prepare-execution'){
   if(r.operation.kind!=='relay'||r.operation.request.operation.kind!=='queue'||!('queue' in result)||!result.queue||!('identity' in result))throw Error('A matching active queue receipt is required.');
   const request=prepareSavingsAction(result.identity,{kind:'execute',target:r.operation.request.operation.details,queue:result.queue});return {request,identity:result.identity,...savingsRehearsalFlags};
  }
  return result;
 }finally{p.destroy();}
}
