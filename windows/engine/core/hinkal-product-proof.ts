import {z} from 'zod';
import {getAddress,keccak256,verifyMessage,formatUnits} from 'ethers';
import {randomUUID} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {canonical,CHAINS} from './payment-intent';
import {multiPublicSchema} from './multi-protocol';
import {HINKAL_PIN} from './hinkal-intent';
import {validateHinkalAcceptanceSeed,verifyHinkalProofAuthorization,verifyHinkalProofLink} from './hinkal-proof-link';

const hash=z.string().regex(/^0x[0-9a-f]{64}$/),scalar=z.string().regex(/^(0|[1-9][0-9]*)$/).max(78);
const requestSchema=z.object({version:z.literal(28),kind:z.literal('drivekey-hinkal-product-proof'),
 requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),
 chain:z.enum(['ethereum','solana']),wallet:multiPublicSchema,expectedSpendingPublicKey:z.tuple([scalar,scalar]),
 seed:z.unknown(),fingerprint:hash}).strict();
export type ProductProofRequest=z.infer<typeof requestSchema>;
const responseSchema=z.object({version:z.literal(28),kind:z.literal('drivekey-hinkal-product-proof-response'),
 requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:hash,signedAt:z.string().datetime(),
 proofAuthorization:z.unknown(),walletAuthorization:z.string().min(64).max(160),
 blockchainTransactionSigned:z.literal(false),submitted:z.literal(false)}).strict();
export type ProductProofResponse=z.infer<typeof responseSchema>;
export const productProofFingerprint=(input:any)=>{const {fingerprint,...body}=input;return keccak256(Buffer.from('DriveKey product private-proof request v28\n'+canonical(body)));};

export function createProductProof(seedInput:unknown,walletInput:unknown,expectedSpendingPublicKey:[string,string],now=Date.now()){
 const seed=validateHinkalAcceptanceSeed(structuredClone(seedInput),now),wallet=multiPublicSchema.parse(walletInput);
 const request={version:28,kind:'drivekey-hinkal-product-proof',requestId:randomUUID(),deviceId:wallet.deviceId,
  createdAt:new Date(now).toISOString(),expiresAt:seed.expiresAt,chain:seed.job.context.chain,wallet,expectedSpendingPublicKey,
  seed,fingerprint:''};request.fingerprint=productProofFingerprint(request);
 return validateProductProof(request,now);
}

function rejectSecretMaterial(input:unknown){
 let nodes=0;
 const visit=(value:any,depth:number)=>{
  if(++nodes>35000||depth>40)throw Error('Private-proof request exceeds the structural limit.');
  if(value===null||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  for(const [key,item]of Object.entries(value)){
   const name=key.replace(/[^a-z]/gi,'').toLowerCase();
   if(['view','vault','password','passphrase','privatekey','secretkey','nullifyingkey','spendingprivatekey','mnemonic','seedphrase','recoveryphrase','loginsignature','rawsignedtransaction','apikey','apitoken'].includes(name)||
      /privatekey|secretkey|password|passphrase|mnemonic|nullifyingkey/.test(name))throw Error('Private-proof requests must not contain secrets or signed chain bytes.');
   visit(item,depth+1);
  }
 };
 visit(input,0);
}

export function validateProductProof(input:unknown,now=Date.now(),expiry=true){
 rejectSecretMaterial(input);
 const r=requestSchema.parse(input),seed=validateHinkalAcceptanceSeed(r.seed,now,expiry),context=seed.job.context;
 const created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt),field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
 if(!Number.isSafeInteger(now)||created>now+60000||created<Date.parse(seed.createdAt)||expires> Date.parse(seed.expiresAt)||
    expires<=created||expires-created>600000||expiry&&now>=expires||r.fingerprint!==productProofFingerprint(r)||
    r.deviceId!==r.wallet.deviceId||r.deviceId!==seed.deviceId||r.chain!==context.chain||context.pendingLeaves.length!==0||
    r.expectedSpendingPublicKey.some(n=>BigInt(n)>=field)||r.expectedSpendingPublicKey.every(n=>BigInt(n)===0n)||
    Buffer.byteLength(JSON.stringify(r))>96*1024)throw Error('Product proof identity, lifetime or scope differs.');
 if(r.chain==='ethereum'?getAddress(context.from)!==getAddress(r.wallet.evmAddress):context.from!==r.wallet.solanaAddress)
  throw Error('Product proof belongs to another wallet.');
 // Existing circuit formats are retained as an internal reconstruction contract.
 // A legacy proof response is never itself a v28 product authorization.
 return r;
}

export function productProofReview(input:unknown,now=Date.now(),expiry=true){
 const r=validateProductProof(input,now,expiry),s:any=r.seed,c=s.job.context;
 const inputAsset=c.tokenIn||c.asset,swap=c.action==='swap',outputAsset=swap?(c.tokenOut||'USDC'):inputAsset;
 const canonicalToken=(asset:string)=>asset==='USDC'?CHAINS[r.chain].usdc:'native';
 const inputDecimals=inputAsset==='USDC'?6:r.chain==='ethereum'?18:9,outputDecimals=outputAsset==='USDC'?6:r.chain==='ethereum'?18:9;
 const minimum=swap?(c.minimumOutput||c.proposal.bounds.minimumOutput):c.amount;
 return {kind:'private-proof',action:'private-proof-'+c.action,proofAction:c.action,chain:r.chain,chainIdentity:r.chain==='ethereum'?'1':CHAINS.solana.genesis,
  from:c.from,recipient:c.recipient,inputAsset,inputToken:canonicalToken(inputAsset),decimals:inputAsset==='USDC'?'6':r.chain==='ethereum'?'18':'9',
  amount:c.amount,formattedInput:formatUnits(c.amount,inputDecimals)+' '+inputAsset,outputAsset,outputToken:canonicalToken(outputAsset),minimumOutput:minimum,formattedMinimum:formatUnits(minimum,outputDecimals)+' '+outputAsset,
  maximumFee:s.maximumFee,maximumAccountRent:s.maximumAccountRent||'0',nonce:s.nonce===undefined?'bound at separately reviewed chain signing':String(s.nonce),
  blockhash:s.chainContext?.blockhash||'bound at separately reviewed chain signing',lastValidBlockHeight:s.chainContext?.lastValidBlockHeight===undefined?'bound at separately reviewed chain signing':String(s.chainContext.lastValidBlockHeight),
  protocolFee:c.protocolFee||c.proposal?.bounds?.protocolFee||'0',slippageBps:String(c.slippageBps??c.proposal?.bounds?.slippageBps??0),
  root:s.job.response.rootHashHinkal||'not supplied',rootIndex:s.job.response.rootHashHinkalIndex||'not supplied',quoteCreatedAt:c.quoteCreatedAt||'not applicable',quoteExpiresAt:c.quoteExpiresAt||r.expiresAt,
  contractOrProgram:r.chain==='ethereum'?HINKAL_PIN.ethereumContract:HINKAL_PIN.solanaProgram,
  inputNoteCount:String(c.inputNotes.length),proofVersion:String(s.version),deadlineUTC:r.expiresAt,
  fingerprint:r.fingerprint,proofFingerprint:s.fingerprint,authority:'Private-proof authorization only. A chain transaction requires a separate review and signature.'};
}

export function productProofWalletMessage(input:ProductProofRequest,proofAuthorization:unknown,signedAt:string){
 // Bind the exact private authorization bytes as well as the user-visible scope.
 return 'DriveKey product private-proof response v28\n'+canonical({requestFingerprint:input.fingerprint,requestId:input.requestId,
  deviceId:input.deviceId,chain:input.chain,signedAt,proofAuthorizationHash:keccak256(Buffer.from(canonical(proofAuthorization)))});
}

export async function verifyProductProofResponse(input:unknown,response:unknown,now=Date.now(),expiry=true){
 const r=validateProductProof(input,now,expiry),s=responseSchema.parse(response),at=Date.parse(s.signedAt);
 if(s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint||at<Date.parse(r.createdAt)||
    at>=Date.parse(r.expiresAt)||at>now+60000)throw Error('Product proof response differs from its review.');
 const message=productProofWalletMessage(r,s.proofAuthorization,s.signedAt);
 if(r.chain==='ethereum'){
  if(getAddress(verifyMessage(message,s.walletAuthorization))!==getAddress(r.wallet.evmAddress))throw Error('Product proof wallet authorization differs.');
 }else if(!nacl.sign.detached.verify(Buffer.from(message),bs58.decode(s.walletAuthorization),new PublicKey(r.wallet.solanaAddress).toBytes()))
  throw Error('Product proof wallet authorization differs.');
 const proofAt=Date.parse((s.proofAuthorization as any)?.signedAt);
 if(!Number.isSafeInteger(proofAt)||proofAt<Date.parse(r.createdAt)||proofAt>at)throw Error('Product proof authorization timestamp differs from its review.');
 await verifyHinkalProofAuthorization(r.seed,s.proofAuthorization,r.expectedSpendingPublicKey,now,expiry);
 return s;
}

export async function verifyProductProofChainLink(input:unknown,response:unknown,chainRequest:unknown,now=Date.now(),expiry=true){
 const r=validateProductProof(input,now,expiry),s=await verifyProductProofResponse(r,response,now,expiry);
 return verifyHinkalProofLink(r.seed,s.proofAuthorization,chainRequest,r.expectedSpendingPublicKey,now,expiry);
}
