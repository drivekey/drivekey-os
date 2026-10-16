// Exact public gas-payer transaction protocol. No key access, RPC or funding authority.
import {z} from 'zod';
import {AbiCoder, getAddress, getCreateAddress, keccak256, toUtf8Bytes, Transaction, ZeroAddress, ZeroHash, formatEther} from 'ethers';
import {SAVINGS_V1_BUILD_IDENTITY, savingsEnrollmentIntentSchema, verifySavingsDeploymentProposal} from './savings-enrollment';
import {savingsReviewExpectationSchema, savingsActionReviewRequestSchema, reviewSavingsAction} from './savings-action-review';
import {savingsApprovalCollectionSchema, buildSavingsPreparedCall} from './savings-action-workflow';
import {parseStrictPublicJson} from './strict-public-json';

const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(getAddress).refine(a=>a!==ZeroAddress);
const uint=z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(v=>BigInt(v)<2n**256n);
const positive=uint.refine(v=>BigInt(v)>0n);
export const savingsGasEnvelopeSchema=z.object({nonce:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),gasLimit:positive,maxFeePerGas:positive,maxPriorityFeePerGas:uint}).strict()
 .refine(v=>BigInt(v.maxPriorityFeePerGas)<=BigInt(v.maxFeePerGas),'Priority fee exceeds maximum fee');
const operation=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('deploy'),intent:savingsEnrollmentIntentSchema}).strict(),
 z.object({kind:z.literal('relay'),expectation:savingsReviewExpectationSchema,request:savingsActionReviewRequestSchema,collection:savingsApprovalCollectionSchema}).strict(),
]);
export const savingsTransactionRequestSchema=z.object({kind:z.literal('drivekey-savings-transaction-request'),version:z.literal(1),chainId:z.literal(1),
 requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),gasPayer:address,
 gas:savingsGasEnvelopeSchema,operation,unsignedTransaction:z.string().max(28002).regex(/^0x(?:[0-9a-f]{2})+$/),fingerprint:hash}).strict();
export type SavingsTransactionRequest=z.infer<typeof savingsTransactionRequestSchema>;
export const savingsTransactionResponseSchema=z.object({kind:z.literal('drivekey-savings-transaction-response'),version:z.literal(1),requestId:z.string().uuid(),deviceId:z.string().uuid(),
 fingerprint:hash,gasPayer:address,signedAt:z.string().datetime(),rawSignedTransaction:z.string().max(28202).regex(/^0x(?:[0-9a-f]{2})+$/),transactionHash:hash,
 submitted:z.literal(false),chainAuthenticated:z.literal(false),fundingReady:z.literal(false),productionReady:z.literal(false)}).strict();
export type SavingsTransactionResponse=z.infer<typeof savingsTransactionResponseSchema>;
export const savingsTransactionFlags={submitted:false,chainAuthenticated:false,fundingReady:false,productionReady:false} as const;
export function savingsTransactionFingerprint(input:unknown){
 const {fingerprint:_,...request}=savingsTransactionRequestSchema.parse(input);
 return keccak256(toUtf8Bytes(JSON.stringify(request)));
}

/** Current pinned contract bytes fit the existing 32 KiB exchange bound. Do not
 * enlarge the bound implicitly if a new candidate no longer fits. */
export function parseSavingsTransactionFile(text:string){
 return z.union([savingsTransactionRequestSchema,savingsTransactionResponseSchema]).parse(parseStrictPublicJson(text,32768));
}
function canonicalTransaction(r:SavingsTransactionRequest,now:number){
 const tx=Transaction.from(r.unsignedTransaction),o=r.operation,g=r.gas;
 let to:string|null,data:string,vault:string,purpose:string,owners:string[];
 if(o.kind==='deploy'){
  const i=o.intent;
  if(i.deployer!==r.gasPayer||i.nonce!==g.nonce||i.gasLimit!==g.gasLimit||i.maxFeePerGas!==g.maxFeePerGas||i.maxPriorityFeePerGas!==g.maxPriorityFeePerGas)
   throw Error('Deployment differs from the reviewed gas payer and fee envelope.');
  const args=AbiCoder.defaultAbiCoder().encode(['uint8','address[]'],[i.configuration.preset,i.configuration.signers]);
  if(tx.data.length<=args.length||!tx.data.endsWith(args.slice(2)))throw Error('Deployment constructor differs from the exact signer configuration.');
  const creation='0x'+tx.data.slice(2,tx.data.length-(args.length-2));
  if(keccak256(creation)!==SAVINGS_V1_BUILD_IDENTITY.creationCodeHash)throw Error('Deployment bytecode differs from the pinned Savings contract.');
  if(getCreateAddress({from:r.gasPayer,nonce:g.nonce})!==i.expectedVault)throw Error('Deployment address differs from the exact gas-payer nonce.');
  to=null;data=creation+args.slice(2);vault=i.expectedVault;purpose='Deploy savings vault';owners=i.configuration.signers;
 }else{
  const call=buildSavingsPreparedCall(o.expectation,o.request,o.collection,now);
  to=call.to;data=call.data;vault=call.to;purpose=call.purpose;owners=o.expectation.configuration.signers;
  // Configuration execution must not promote the everyday gas key into an
  // owner. Keep this check at the signing boundary, not merely in online setup.
  // Cancelling a harmful proposal remains permitted under the current quorum.
  const op=o.request.operation;
  if((op.kind==='queue'||op.kind==='execute')&&op.details.newConfiguration)owners=[...owners,...op.details.newConfiguration.signers];
 }
 if(owners.includes(r.gasPayer)||r.gasPayer===vault)throw Error('Use the separate everyday wallet for gas, not a current or proposed savings signer or the savings vault.');
 if(tx.isSigned()||tx.type!==2||tx.chainId!==1n||tx.to!==to||tx.data!==data||tx.value!==0n||tx.accessList?.length||
   tx.nonce!==g.nonce||tx.gasLimit!==BigInt(g.gasLimit)||tx.maxFeePerGas!==BigInt(g.maxFeePerGas)||tx.maxPriorityFeePerGas!==BigInt(g.maxPriorityFeePerGas)||
   tx.unsignedSerialized!==r.unsignedTransaction)throw Error('Transaction differs from the exact savings operation or gas envelope.');
 return {tx,vault,purpose,owners};
}
export function reviewSavingsTransaction(input:unknown,now=Date.now()){
 const r=savingsTransactionRequestSchema.parse(input),created=Date.parse(r.createdAt),expiry=Date.parse(r.expiresAt);
 if(!Number.isSafeInteger(now)||created>now+60000||expiry<=created||expiry-created>86400000||now>=expiry)throw Error('Savings transaction review expired or clock differs.');
 if(savingsTransactionFingerprint(r)!==r.fingerprint)throw Error('Savings transaction fingerprint differs.');
 const c=canonicalTransaction(r,now),rows:{label:string;value:string}[]=[{label:'Network',value:'Ethereum · chain 1'},
  {label:'Purpose',value:c.purpose},{label:'Gas wallet',value:r.gasPayer},{label:'Savings vault',value:c.vault},
  {label:'Gas-wallet nonce',value:String(r.gas.nonce)},{label:'Gas limit',value:r.gas.gasLimit},
  {label:'Maximum network fee',value:formatEther(BigInt(r.gas.gasLimit)*BigInt(r.gas.maxFeePerGas))+' ETH'},
  {label:'Maximum fee per gas',value:r.gas.maxFeePerGas+' wei'},{label:'Priority fee per gas',value:r.gas.maxPriorityFeePerGas+' wei'},
  {label:'ETH attached to call',value:'0 ETH'},{label:'Review deadline',value:r.expiresAt}];
 if(r.operation.kind==='deploy'){
  const i=r.operation.intent;rows.push({label:'Protection',value:i.configuration.preset===0?'Standard · 1 signer · 5 minutes':'Strong · 2 of 3 · 15 minutes'},
   {label:'Security-change delay',value:'1 hour'},{label:'Pinned runtime hash',value:SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash});
  i.configuration.signers.forEach((s,n)=>rows.push({label:`Savings signer ${n+1}`,value:s}));
 }else{
  const o=r.operation,review=reviewSavingsAction(o.expectation,o.request,o.expectation.configuration.signers[0],now);
  // This is the separate gas key, not the first owner used for structural review.
  rows.push(...review.rows.filter(row=>row.label!=='This offline signer'));rows.push({label:'Verified owner approvals',value:String(o.collection.authorizations.length)});
 }
 return {request:r,fingerprint:r.fingerprint,purpose:c.purpose,network:'ethereum' as const,rows,
  maximumNetworkFeeWei:(BigInt(r.gas.gasLimit)*BigInt(r.gas.maxFeePerGas)).toString(),vault:c.vault,
  warning:'Unfunded candidate. Imported identity and chain state are untrusted. A review deadline cannot revoke signed Ethereum transaction bytes. Signing does not submit or confirm an action.',...savingsTransactionFlags};
}

/** Factory accepts the same strict schema; it computes the fingerprint, never changes terms. */
export function createSavingsTransactionRequest(input:unknown,now=Date.now()):SavingsTransactionRequest{
 const r=savingsTransactionRequestSchema.parse(input);r.fingerprint=savingsTransactionFingerprint(r);reviewSavingsTransaction(r,now);
 if(new TextEncoder().encode(JSON.stringify(r,null,2)+'\n').length>32768)throw Error('Savings transaction exceeds the existing exchange limit.');
 return r;
}
export function prepareSavingsDeploymentTransaction(artifact:unknown,intent:unknown,proposal:unknown,metadata:{requestId:string;deviceId:string;createdAt:string;expiresAt:string},now=Date.now()){
 const d=verifySavingsDeploymentProposal(artifact,intent,proposal),i=savingsEnrollmentIntentSchema.parse(intent);
 return createSavingsTransactionRequest({kind:'drivekey-savings-transaction-request',version:1,chainId:1,...metadata,gasPayer:i.deployer,
  gas:{nonce:i.nonce,gasLimit:i.gasLimit,maxFeePerGas:i.maxFeePerGas,maxPriorityFeePerGas:i.maxPriorityFeePerGas},operation:{kind:'deploy',intent:i},
  unsignedTransaction:d.unsignedTransaction,fingerprint:ZeroHash},now);
}
export function prepareSavingsRelayTransaction(expectation:unknown,request:unknown,collection:unknown,gasPayer:string,gas:unknown,
 metadata:{requestId:string;deviceId:string;createdAt:string;expiresAt:string},now=Date.now()){
 const e=savingsReviewExpectationSchema.parse(expectation),q=savingsActionReviewRequestSchema.parse(request),c=savingsApprovalCollectionSchema.parse(collection),g=savingsGasEnvelopeSchema.parse(gas);
 const call=buildSavingsPreparedCall(e,q,c,now),tx=Transaction.from({type:2,chainId:1,to:call.to,value:0,data:call.data,accessList:[],...g});
 return createSavingsTransactionRequest({kind:'drivekey-savings-transaction-request',version:1,chainId:1,...metadata,gasPayer,gas:g,operation:{kind:'relay',expectation:e,request:q,collection:c},unsignedTransaction:tx.unsignedSerialized,fingerprint:ZeroHash},now);
}
export function verifySavingsTransactionResponse(input:unknown,request:unknown,now=Date.now()){
 const review=reviewSavingsTransaction(request,now),r=review.request,s=savingsTransactionResponseSchema.parse(input),tx=Transaction.from(s.rawSignedTransaction);
 if(s.requestId!==r.requestId||s.deviceId!==r.deviceId||s.fingerprint!==r.fingerprint||s.gasPayer!==r.gasPayer||
  Date.parse(s.signedAt)<Date.parse(r.createdAt)||Date.parse(s.signedAt)>now+60000||Date.parse(s.signedAt)>=Date.parse(r.expiresAt)||
  !tx.isSigned()||tx.from!==r.gasPayer||tx.unsignedSerialized!==r.unsignedTransaction||tx.serialized!==s.rawSignedTransaction||tx.hash!==s.transactionHash)
  throw Error('Gas-wallet signature does not match the exact reviewed savings transaction.');
 return s;
}
