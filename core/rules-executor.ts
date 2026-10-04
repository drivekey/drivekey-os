// Node-only executor for a dedicated relayer. The journal directory MUST be
// shared by every process using that signer. No lease expiry or automatic retry.
import {mkdir,open,unlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {timingSafeEqual,createHash} from 'node:crypto';
import {Contract,Interface,JsonRpcProvider,Transaction,keccak256,ZeroAddress,toQuantity,type Signer} from 'ethers';
import {z} from 'zod';
import {readJsonFile as readBounded,writeJsonFile as writeBounded,safeDirectory} from './files';
// Journals contain both the complete authorization and exact signed transaction.
// Offline exchange files retain the existing 32 KiB default.
const readJsonFile=(directory:string,filename:string)=>readBounded(directory,filename,131072);
const writeJsonFile=(directory:string,filename:string,value:unknown,replace=false)=>writeBounded(directory,filename,value,replace,131072);
import {verifySignedRules,encodeRules,rulesPaymentSchema,type RulesContext,rulesContextSchema} from './rules-protocol';
import {checkKnownRobinhoodProxy,ROBINHOOD_USDG_IDENTITY} from './robinhood-proxy-identity';
export const RULES_ACCOUNT_ABI=[
 'function agent() view returns(address)','function approver() view returns(address)','function guardian() view returns(address)',
 'function registry() view returns(address)','function owner() view returns(address)','function stablecoin() view returns(address)','function CONTRACT_VERSION() view returns(uint256)','function ownerEpoch() view returns(uint256)','function revision() view returns(uint256)','function safetyEpoch() view returns(uint256)','function paused() view returns(bool)','function policyHash() view returns(bytes32)',
 'function applyPolicy(bytes,uint256,bytes32,uint256,uint256,bytes)','function stop()','function requestPayment(bytes32,address,address,uint256,uint8,uint256)','function executeApproved(bytes32,bytes)',
 'event PolicyApplied(uint256 indexed revision,bytes32 indexed policyHash,uint256 safetyEpoch)',
 'event Stopped(uint256 safetyEpoch)',
 'event ApprovalRequested(bytes32 indexed paymentId,address asset,address recipient,uint256 amount,uint8 category,uint256 revision,uint256 safetyEpoch,uint256 expiry)',
 'event PaymentExecuted(bytes32 indexed paymentId,address indexed asset,address indexed recipient,uint256 amount,uint8 category,uint256 revision)'];
const iface=new Interface(RULES_ACCOUNT_ABI);
const paymentRequest=rulesPaymentSchema.omit({revision:true,safetyEpoch:true});
export type RulesOperation={kind:'apply';authorization:unknown;explicitApply:true}|{kind:'payment';payment:z.infer<typeof paymentRequest>}|{kind:'stop'}|{kind:'approved-payment';payment:z.infer<typeof rulesPaymentSchema>;signature:string};
export type RulesDeployment={account:string;registry:string;accountCodeHash:string;registryCodeHash:string;owner:string;signer:string;signerRole:'agent'|'relayer'|'guardian';maxFeePerGas:bigint;maxGas:bigint;maxTotalFee:bigint;allowedSelectors:string[]};
export type RulesSigner={getAddress():Promise<string>;signTransaction:Signer['signTransaction']};
export function authenticateRulesAgent(presented:string,configured:string){
 if(configured.length<32||presented.length>512)throw Error('Agent authentication unavailable.');
 const hash=(s:string)=>createHash('sha256').update(s).digest();
 if(!timingSafeEqual(hash(presented),hash(configured)))throw Error('Unauthorized agent.');
}
export async function checkRulesDeployment(provider:JsonRpcProvider,p:RulesDeployment){
 if(BigInt(await provider.send('eth_chainId',[]))!==4663n)throw Error('Wrong chain.');
 const block=await provider.getBlock('latest');if(!block?.hash)throw Error('Missing canonical block.');
 const account=new Contract(p.account,RULES_ACCOUNT_ABI,provider),opts={blockTag:block.number};
 const [a,r,registry,owner,asset,version]=await Promise.all([provider.getCode(p.account,block.number),provider.getCode(p.registry,block.number),account.registry(opts),account.owner(opts),account.stablecoin(opts),account.CONTRACT_VERSION(opts)]);
 if(keccak256(a)!==p.accountCodeHash||keccak256(r)!==p.registryCodeHash||registry.toLowerCase()!==p.registry.toLowerCase()||owner.toLowerCase()!==p.owner.toLowerCase()||asset.toLowerCase()!==ROBINHOOD_USDG_IDENTITY.token.toLowerCase()||version!==4n)throw Error('Deployment identity mismatch.');
 await checkKnownRobinhoodProxy((method,params=[])=>provider.send(method,params),ROBINHOOD_USDG_IDENTITY.token);
 if((await provider.getBlock(block.number))?.hash!==block.hash)throw Error('Identity observation reorganized.');
 return account;
}
type Journal={id:string;kind:RulesOperation['kind'];status:'intent'|'signed'|'submitted'|'unknown'|'confirmed'|'finalized'|'failed';account:string;signer:string;nonce:number;data:string;maxFeePerGas:string;maxPriorityFeePerGas:string;gasLimit:string;raw?:string;hash?:string;outcome?:string;blockHash?:string;operation:RulesOperation};
export class RulesExecutor {
 constructor(readonly directory:string,readonly provider:JsonRpcProvider,readonly pins:RulesDeployment,readonly signer:RulesSigner){}
 async initialize(){await mkdir(this.directory,{recursive:true,mode:0o700});await safeDirectory(this.directory);}
 async freshNonce(sender:string){const nonce=Number(BigInt(await this.provider.send('eth_getTransactionCount',[sender,'pending'])));if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('Invalid nonce.');return nonce;}
 async submit(id:string,operation:RulesOperation){
  if(!/^[a-z0-9-]{1,80}$/.test(id))throw Error('Invalid request identity.');
  await this.initialize();
  const sender=await this.signer.getAddress();if(sender.toLowerCase()!==this.pins.signer.toLowerCase()||sender.toLowerCase()===this.pins.owner.toLowerCase())throw Error('Relayer identity mismatch.');
  const filename=`rules-intent-${id}.json`,claim=`rules-nonce-${sender.slice(2).toLowerCase()}.json`;
  // Exclusive, fsynced claim precedes all signing. It survives process death.
  await writeJsonFile(this.directory,claim,{id,account:this.pins.account,signer:sender},false);
  let record:Journal|undefined;
  try{
   const account=await checkRulesDeployment(this.provider,this.pins);let data:string;
   if(operation.kind==='apply'){
    if(operation.explicitApply!==true)throw Error('Explicit Apply required.');const s=verifySignedRules(operation.authorization),c=s.draft.context;
    if(c.account.toLowerCase()!==this.pins.account.toLowerCase()||c.registry.toLowerCase()!==this.pins.registry.toLowerCase()||c.accountCodeHash!==this.pins.accountCodeHash||c.registryCodeHash!==this.pins.registryCodeHash||c.owner.toLowerCase()!==this.pins.owner.toLowerCase())throw Error('Authorization targets another deployment.');
    if(BigInt(c.revision)!==await account.revision()||c.policyHash!==await account.policyHash()||BigInt(c.safetyEpoch)!==await account.safetyEpoch())throw Error('Stale policy authorization.');
    data=iface.encodeFunctionData('applyPolicy',[encodeRules(s.draft.rules),c.revision,c.policyHash,c.safetyEpoch,s.draft.authorizationExpiry,s.signature]);
   } else if(operation.kind==='stop')data=iface.encodeFunctionData('stop');
   else if(operation.kind==='payment'){
    const p=paymentRequest.parse(operation.payment);data=iface.encodeFunctionData('requestPayment',[p.paymentId,p.asset,p.recipient,p.amount,p.category,p.expiry]);
   } else {const p=rulesPaymentSchema.parse(operation.payment);if(!/^0x[0-9a-f]{130}$/i.test(operation.signature))throw Error('Invalid approval signature.');data=iface.encodeFunctionData('executeApproved',[p.paymentId,operation.signature]);}
   // Exact configured selector set; adding owner-signing or arbitrary calls is rejected.
   const names=this.pins.signerRole==='guardian'?['stop']:this.pins.signerRole==='relayer'?['applyPolicy']:['requestPayment','executeApproved'];
   const allowed=names.map(n=>iface.getFunction(n)!.selector).sort();
   if(JSON.stringify([...this.pins.allowedSelectors].sort())!==JSON.stringify(allowed)||!allowed.includes(data.slice(0,10)))throw Error('Signer scope mismatch.');
   if(this.pins.signerRole!=='relayer'&&(await account[this.pins.signerRole]()).toLowerCase()!==sender.toLowerCase())throw Error('Signer no longer holds the required role.');
   const nonce=await this.freshNonce(sender),fees=await this.provider.getFeeData();
   if(!fees.maxFeePerGas||fees.maxPriorityFeePerGas===null||fees.maxFeePerGas>this.pins.maxFeePerGas)throw Error('Fee ceiling exceeded.');
   const tx={type:2,chainId:4663,to:this.pins.account,from:sender,value:0n,data,nonce,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas};
   const gasLimit=await this.provider.estimateGas(tx)*12n/10n;
   if(gasLimit>this.pins.maxGas||gasLimit*fees.maxFeePerGas>this.pins.maxTotalFee)throw Error('Total gas ceiling exceeded.');
   const simulation={from:sender,to:tx.to,data,value:'0x0',type:'0x2',nonce:toQuantity(nonce),gas:toQuantity(gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas)};
   await this.provider.send('eth_call',[simulation,'latest']);
   record={id,kind:operation.kind,status:'intent',account:this.pins.account,signer:sender,nonce,data,maxFeePerGas:tx.maxFeePerGas.toString(),maxPriorityFeePerGas:tx.maxPriorityFeePerGas.toString(),gasLimit:gasLimit.toString(),operation};
   await writeJsonFile(this.directory,filename,record,false);
   const raw=await this.signer.signTransaction({...tx,gasLimit});const signed=Transaction.from(raw);
   if(!signed.signature||signed.from?.toLowerCase()!==sender.toLowerCase()||signed.to?.toLowerCase()!==tx.to.toLowerCase()||signed.data!==data||signed.value!==0n||signed.nonce!==nonce||signed.chainId!==4663n||signed.type!==2||signed.gasLimit!==gasLimit||signed.maxFeePerGas!==tx.maxFeePerGas||signed.maxPriorityFeePerGas!==tx.maxPriorityFeePerGas||signed.accessList?.length)throw Error('Signer returned different transaction.');
   record={...record,status:'signed',raw,hash:signed.hash!};await writeJsonFile(this.directory,filename,record,true);
   await checkRulesDeployment(this.provider,this.pins);
   if(await this.freshNonce(sender)!==nonce)throw Error('Nonce changed before broadcast.');
   await this.provider.send('eth_call',[simulation,'latest']);
   // This is the only broadcast. Any failure thereafter retains the claim.
   record.status='unknown';await writeJsonFile(this.directory,filename,record,true);
   const sent=await this.provider.broadcastTransaction(raw);if(sent.hash!==record.hash)throw Error('Broadcast hash mismatch.');
   record.status='submitted';await writeJsonFile(this.directory,filename,record,true);return record;
  }catch(error){
   // No automatic reclaim even for pre-signing failures: recovery inspects evidence.
   if(record){record.status='unknown';await writeJsonFile(this.directory,filename,record,true).catch(()=>{});}
   else await unlink(join(this.directory,claim)); // Signing was never reached.
   throw error;
  }
 }
 async status(id:string){if(!/^[a-z0-9-]{1,80}$/.test(id))throw Error('Invalid identity.');return readJsonFile(this.directory,`rules-intent-${id}.json`) as Promise<Journal>;}
 async history(){
  await this.initialize();const names=(await readdir(this.directory)).filter(n=>/^rules-intent-[a-z0-9-]{1,80}\.json$/.test(n));
  if(names.length>1000)throw Error('History requires pagination.');
  const result=[];for(const name of names){const r=await readJsonFile(this.directory,name) as Journal;if(r.account.toLowerCase()!==this.pins.account.toLowerCase())continue;result.push({id:r.id,kind:r.kind,status:r.status,outcome:r.outcome,hash:r.hash,blockHash:r.blockHash});}return result;
 }
 async reconcile(id:string){
  if(BigInt(await this.provider.send('eth_chainId',[]))!==4663n)throw Error('Wrong reconciliation chain.');
  const r=await this.status(id);if(!r.raw||!r.hash)return r;
  const tx=Transaction.from(r.raw);if(tx.hash!==r.hash||tx.from?.toLowerCase()!==r.signer.toLowerCase()||tx.data!==r.data)throw Error('Journal mismatch.');
  const [actual,receipt]=await Promise.all([this.provider.getTransaction(r.hash),this.provider.getTransactionReceipt(r.hash)]);
  if(!actual||!receipt){r.status='unknown';delete r.outcome;delete r.blockHash;await writeJsonFile(this.directory,`rules-intent-${id}.json`,r,true);return r;}
  const actualRaw=Transaction.from({type:actual.type,to:actual.to,nonce:actual.nonce,gasLimit:actual.gasLimit,maxFeePerGas:actual.maxFeePerGas,maxPriorityFeePerGas:actual.maxPriorityFeePerGas,data:actual.data,value:actual.value,chainId:actual.chainId,accessList:actual.accessList,signature:actual.signature}).serialized;
  if(actualRaw!==r.raw||receipt.hash!==r.hash||actual.blockHash!==receipt.blockHash||(await this.provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('Transaction/receipt/canonical evidence mismatch.');
  const events=receipt.logs.filter(l=>l.address.toLowerCase()===r.account.toLowerCase()).flatMap(l=>{try{const e=iface.parseLog(l);return e?[e]:[];}catch{return [];}});
  if(receipt.status===0)r.outcome='reverted';
  else if(r.operation.kind==='apply'){
   const s=verifySignedRules(r.operation.authorization,Date.parse((r.operation.authorization as {signedAt:string}).signedAt));
   if(!events.some(e=>e.name==='PolicyApplied'&&e.args[0]===BigInt(s.draft.context.revision+1)&&e.args[1]===keccak256(encodeRules(s.draft.rules))))throw Error('No matching policy application event.');r.outcome='policy-active';
  }else if(r.operation.kind==='stop'){if(!events.some(e=>e.name==='Stopped'))throw Error('No stop event.');r.outcome='stopped';}
  else{
   const p=r.operation.payment;
   const match=(e:typeof events[number])=>e.args.paymentId===p.paymentId&&e.args.asset.toLowerCase()===p.asset.toLowerCase()&&e.args.recipient.toLowerCase()===p.recipient.toLowerCase()&&e.args.amount===BigInt(p.amount)&&Number(e.args.category)===p.category;
   if(events.some(e=>e.name==='PaymentExecuted'&&match(e)))r.outcome='payment-confirmed';
   else if(r.operation.kind==='payment'&&events.some(e=>e.name==='ApprovalRequested'&&match(e)))r.outcome='awaiting-offline-approval';
   else throw Error('No matching payment evidence.');
   if(r.outcome==='payment-confirmed'&&p.asset!==ZeroAddress){
    const token=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
    if(!receipt.logs.some(l=>{try{const e=token.parseLog(l);return l.address.toLowerCase()===p.asset.toLowerCase()&&e?.args.from.toLowerCase()===r.account.toLowerCase()&&e.args.to.toLowerCase()===p.recipient.toLowerCase()&&e.args.value===BigInt(p.amount);}catch{return false;}}))throw Error('Token delivery evidence missing.');
   }
  }
  const finalized=await this.provider.getBlock('finalized');const final=!!finalized&&finalized.number>=receipt.blockNumber;
  if((await this.provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('Evidence reorganized during reconciliation.');
  r.status=final?(receipt.status===0?'failed':'finalized'):'confirmed';r.blockHash=receipt.blockHash;
  await writeJsonFile(this.directory,`rules-intent-${id}.json`,r,true);
  // Claims stay reserved through confirmation, and are released only after finality.
  if(final){const name=`rules-nonce-${r.signer.slice(2).toLowerCase()}.json`;const claim=await readJsonFile(this.directory,name).catch(()=>null) as {id?:string}|null;if(claim?.id===id)await unlink(join(this.directory,name));}
  return r;
 }
}
