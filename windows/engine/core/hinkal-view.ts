// Public request/response verification only. No private transport key or view.
import {z} from 'zod';
import {getAddress,keccak256,verifyMessage,formatUnits} from 'ethers';
import {createPublicKey} from 'node:crypto';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {canonical,CHAINS} from './payment-intent';
import {multiPublicSchema} from './multi-protocol';
import {validateHinkalProofContext} from './hinkal-proof-job';
import {validateHinkalSolanaProofContext} from './hinkal-solana-proof-job';
import {validateHinkalEvmSwapContext} from './hinkal-evm-swap-proof';
import {validateHinkalSolanaSwapContext} from './hinkal-local-solana-swap';
import {hinkalSolanaSwapRoute} from './hinkal-solana-swap-route';
import {assertHinkalSolanaRouteQualified} from './hinkal-solana-route-admission';
import {validatePublicNoteSnapshot,validatePublicNotePage} from './hinkal-note-snapshot';
import {validateHinkalSolana,assertHinkalSolanaWallet} from './hinkal-solana-intent';
const hash=z.string().regex(/^0x[0-9a-f]{64}$/),uint=z.string().regex(/^(0|[1-9][0-9]*)$/).max(39);
const depositContext=z.object({testOnly:z.literal(true),chain:z.literal('solana'),action:z.literal('deposit'),asset:z.enum(['SOL','USDC']),amount:uint,from:z.string().max(44),recipient:z.string().max(44),inputNotes:z.array(z.string()).length(0),pendingLeaves:z.array(z.string()).length(0)}).strict();
function validateDepositContext(input:unknown){const c=depositContext.parse(input);if(c.from!==c.recipient||!PublicKey.isOnCurve(new PublicKey(c.from).toBytes())||BigInt(c.amount)<=0n||BigInt(c.amount)>=1n<<64n)throw Error('Solana deposit viewing scope differs.');return c;}
export const viewPublicKey=z.string().length(60).superRefine((value,ctx)=>{try{const bytes=Buffer.from(value,'base64'),key=createPublicKey({key:bytes,format:'der',type:'spki'});if(bytes.length!==44||bytes.toString('base64')!==value||key.asymmetricKeyType!=='x25519'||key.export({format:'der',type:'spki'}).toString('base64')!==value)throw Error();}catch{ctx.addIssue({code:'custom',message:'Invalid X25519 transport public key.'});}});
const schema=z.object({version:z.literal(30),kind:z.literal('drivekey-hinkal-view-request'),requestId:z.string().uuid(),deviceId:z.string().uuid(),
 createdAt:z.string().datetime(),expiresAt:z.string().datetime(),wallet:multiPublicSchema,profile:z.union([z.literal(13),z.literal(14),z.literal(15),z.literal(19),z.literal(27)]),context:z.unknown(),
 nonce:z.number().int().min(0).max(4294967295).nullable(),maximumFee:uint,maximumAccountRent:uint,transportPublicKey:viewPublicKey,fingerprint:hash}).strict();
export type ViewRequest=z.infer<typeof schema>;
export const viewFingerprint=(input:any)=>{const {fingerprint,...body}=input;return keccak256(Buffer.from('DriveKey scoped private view request v30\n'+canonical(body)));};
export function validateViewRequest(input:unknown,now=Date.now(),expiry=true){
 const r=schema.parse(input),c=r.profile===13?validateHinkalProofContext(r.context):r.profile===14?validateDepositContext(r.context):r.profile===15?validateHinkalSolanaProofContext(r.context):r.profile===19?validateHinkalEvmSwapContext(r.context,!expiry):validateHinkalSolanaSwapContext(r.context),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt),swap=r.profile===19||r.profile===27;
 if(!Number.isSafeInteger(now)||created>now+60000||expires<=created||expires-created>600000||expiry&&now>=expires||r.deviceId!==r.wallet.deviceId||r.fingerprint!==viewFingerprint(r)||c.pendingLeaves.length||
  (c.chain==='ethereum'?getAddress(c.from)!==getAddress(r.wallet.evmAddress)||r.nonce===null||r.maximumAccountRent!=='0'||BigInt(r.maximumFee)>10n**16n:c.from!==r.wallet.solanaAddress||r.nonce!==null||BigInt(r.maximumAccountRent)>(swap?40000000n:10000000n)||BigInt(r.maximumFee)>100000n)||
  BigInt(r.maximumFee)<=0n||Buffer.byteLength(JSON.stringify(r))>64*1024)throw Error('Private view identity, scope or lifetime differs.');
 if(swap){const s=c as any;if(s.inputNotes.length>2||new Set(s.inputNotes).size!==s.inputNotes.length||created<Date.parse(s.quoteCreatedAt)||expires>Date.parse(s.quoteExpiresAt)||expires-created>180000)throw Error('Private swap view inputs or exact quote lifetime differ.');if(r.profile===27){if(BigInt(s.proposal.bounds.maximumFee)>BigInt(r.maximumFee))throw Error('Private swap route fee exceeds the reviewed ceiling.');assertHinkalSolanaRouteQualified(hinkalSolanaSwapRoute(s.proposal,'1').review);}}
 return {...r,context:c};
}
// The outer viewing approval never authorizes a chain signature. Bind the
// independently decoded deposit to it before retaining or exporting a request.
export function validateDepositViewPreparation(request:unknown,response:unknown,input:unknown,now=Date.now(),expiry=true){
 const r=validateViewRequest(request,now,expiry),s=verifyViewResponse(r,response,now,expiry);
 if(r.profile!==14||r.context.action!=='deposit')throw Error('Expected a Solana deposit viewing request.');
 const p=z.object({version:z.literal(30),kind:z.literal('drivekey-hinkal-deposit-preparation'),deviceId:z.string().uuid(),requestId:z.string().uuid(),fingerprint:hash,transactionRequest:z.unknown(),blockchainTransactionSigned:z.literal(false),submitted:z.literal(false)}).strict().parse(input),tx=validateHinkalSolana(p.transactionRequest,now,expiry);
 assertHinkalSolanaWallet(tx,r.wallet);
 if(p.deviceId!==r.deviceId||p.requestId!==r.requestId||p.fingerprint!==r.fingerprint||tx.from!==r.context.from||tx.recipient!==r.context.recipient||tx.asset!==r.context.asset||tx.amount!==r.context.amount||BigInt(tx.maximumFee)>BigInt(r.maximumFee)||BigInt(tx.accountRent)>BigInt(r.maximumAccountRent)||Date.parse(tx.createdAt)<Date.parse(s.authorizedAt)||Date.parse(tx.expiresAt)>Date.parse(r.expiresAt))throw Error('Prepared Solana deposit changed its original viewing scope.');
 return tx;
}
export const privateViewInputAsset=(context:any):'ETH'|'SOL'|'USDC'=>context.action==='swap'?(context.tokenIn??context.asset):context.asset;
const swapParameters=z.object({chain:z.enum(['ethereum','solana']),amount:uint,nonce:z.number().int().min(0).max(4294967295).nullable(),maximumFee:uint,maximumAccountRent:uint,slippageBps:z.literal(100)}).strict();
export function privateSwapDraftParameters(input:unknown){const p=swapParameters.parse(input);if(BigInt(p.amount)<=0n||BigInt(p.amount)>=(p.chain==='ethereum'?1n<<128n:1n<<64n)||BigInt(p.maximumFee)<=0n||(p.chain==='ethereum'?p.nonce===null||p.maximumAccountRent!=='0'||BigInt(p.maximumFee)>10n**16n:p.nonce!==null||BigInt(p.maximumFee)>100000n||BigInt(p.maximumAccountRent)>40000000n))throw Error('Choose exact native swap input, nonce, fee, rent and the existing one-percent slippage ceiling.');return p;}
// Resolve only the original selected ciphertexts, without opening a capability.
// The isolated preparation worker verifies the actual public path mathematics.
export function privateViewSwapWitness(request:unknown,input:unknown,now=Date.now(),expiry=true){const r=validateViewRequest(request,now,expiry);if(r.profile!==19&&r.profile!==27)throw Error('A local private swap view is required.');const f=z.object({manifest:z.unknown(),pages:z.array(z.unknown()).min(1).max(2)}).strict().parse(input),manifest=validatePublicNoteSnapshot(f.manifest),pages=f.pages.map(p=>validatePublicNotePage(manifest,p).page);if(manifest.chain!==r.context.chain||new Set(pages.map(p=>p.index)).size!==pages.length||pages.some(p=>!p.leaves.some(l=>r.context.inputNotes.includes(l.encryptedOutput))))throw Error('Private swap public witnesses differ.');const paths=r.context.inputNotes.map(cipher=>{const leaves=pages.flatMap(p=>p.leaves).filter(l=>l.encryptedOutput===cipher);if(leaves.length!==1||leaves[0].providerMarkedBlocked)throw Error('A private swap input is missing, repeated or blocked.');return leaves[0].path;});if(new Set(paths.map(p=>p.commitment)).size!==paths.length)throw Error('Private swap input commitments repeat.');return {root:manifest.root,rootIndex:manifest.rootIndex,paths};}
export function assertViewWallet(r:ViewRequest,wallet:unknown){if(canonical(multiPublicSchema.parse(wallet))!==canonical(r.wallet))throw Error('Private view belongs to another complete wallet identity.');}
export const sealedViewSchema=z.object({ephemeralPublicKey:viewPublicKey,iv:z.string().regex(/^[0-9a-f]{24}$/),ciphertext:z.string().min(4).max(4096).regex(/^[A-Za-z0-9+/]+={0,2}$/),tag:z.string().regex(/^[0-9a-f]{32}$/)}).strict();
const responseSchema=z.object({version:z.literal(30),kind:z.literal('drivekey-hinkal-view-response'),deviceId:z.string().uuid(),requestId:z.string().uuid(),fingerprint:hash,
 authorizedAt:z.string().datetime(),sealed:sealedViewSchema,walletAuthorization:z.string().min(64).max(160),blockchainTransactionSigned:z.literal(false),submitted:z.literal(false)}).strict();
export const viewResponseMessage=(request:ViewRequest,response:any)=>'DriveKey scoped encrypted private view response v30\n'+canonical({requestFingerprint:request.fingerprint,deviceId:request.deviceId,requestId:request.requestId,authorizedAt:response.authorizedAt,sealed:response.sealed});
export function verifyViewResponse(request:unknown,input:unknown,now=Date.now(),expiry=true){
 const r=validateViewRequest(request,now,expiry),s=responseSchema.parse(input),at=Date.parse(s.authorizedAt),cipher=Buffer.from(s.sealed.ciphertext,'base64');
 if(s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint||at<Date.parse(r.createdAt)||at>=Date.parse(r.expiresAt)||at>now+60000||cipher.length>2048||cipher.toString('base64')!==s.sealed.ciphertext)throw Error('Encrypted private view response differs.');
 const message=viewResponseMessage(r,s);
 if(r.context.chain==='ethereum'?getAddress(verifyMessage(message,s.walletAuthorization))!==getAddress(r.wallet.evmAddress):!nacl.sign.detached.verify(Buffer.from(message),bs58.decode(s.walletAuthorization),new PublicKey(r.wallet.solanaAddress).toBytes()))throw Error('Encrypted private view wallet authorization differs.');
 return s;
}
export function viewReview(input:unknown,now=Date.now(),expiry=true){const r=validateViewRequest(input,now,expiry),c=r.context,asset=privateViewInputAsset(c),decimals=asset==='USDC'?6:c.chain==='ethereum'?18:9,s:any=c,swap=c.action==='swap',bounds=s.proposal?.bounds??s;return {action:'Authorize encrypted private view',chain:c.chain,chainIdentity:c.chain==='ethereum'?'1':CHAINS.solana.genesis,from:c.from,asset,canonicalToken:asset==='USDC'?CHAINS[c.chain].usdc:'native',decimals:String(decimals),proofAction:c.action,recipient:c.recipient,amount:c.amount,formattedAmount:formatUnits(c.amount,decimals)+' '+asset,inputNotes:String(c.inputNotes.length),maximumFee:r.maximumFee,maximumAccountRent:r.maximumAccountRent,nonce:r.nonce===null?'bound at chain review':String(r.nonce),deadlineUTC:r.expiresAt,transportPublicKey:r.transportPublicKey,fingerprint:r.fingerprint,...swap?{outputAsset:'USDC',canonicalOutputToken:CHAINS[c.chain].usdc,outputDecimals:6,quotedOutput:bounds.quotedOutput,minimumOutput:bounds.minimumOutput,formattedMinimumOutput:formatUnits(bounds.minimumOutput,6)+' USDC',slippageBps:bounds.slippageBps,protocolFeeBaseUnits:bounds.protocolFee,quoteDeadlineUTC:s.quoteExpiresAt,routeFingerprint:createHash('sha256').update(canonical(s.routeData??s.proposal)).digest('hex')}:{},
 authority:'Sensitive read access to the Hinkal identity, including other balances and incoming transfers. This app restricts use to this draft; that restriction and expiry cannot revoke a disclosed key. No circuit authorization or transaction signature.'};}

// Metadata only, bound to the complete original wallet/draft. A time-bound
// nullifier read is not portable signing authority or a complete balance.
const scalar=z.string().regex(/^[1-9][0-9]*$/).max(78).refine(v=>BigInt(v)<21888242871839275222246405745257275088548364400416034343698204186575808495617n),index=z.string().regex(/^(0|[1-9][0-9]*)$/).max(78),safe=z.number().int().nonnegative().safe(),quantity=z.string().max(66).regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/),blockHash=z.string().regex(/^0x[0-9a-f]{64}$/).refine(v=>BigInt(v)!==0n),solHash=z.string().max(44).refine(v=>{try{return new PublicKey(v).toBase58()===v;}catch{return false;}});
const commonObservation={origin:z.string().max(256),root:scalar,rootIndex:index,unspentInputCount:z.number().int().min(1).max(6),observedAt:z.string().datetime(),settled:z.literal(false),authorityGranted:z.literal(false)};
const chainObservation=z.union([z.object({...commonObservation,chain:z.literal('ethereum'),blockNumber:quantity,blockHash,pendingRechecked:z.literal(true)}).strict(),z.object({...commonObservation,chain:z.literal('solana'),contextSlot:safe,nullifierContextSlot:safe,merkleMIndex:index,finalizedSlot:safe,finalizedBlockHash:solHash,confirmedRechecked:z.literal(true)}).strict()]);
const observationSchema=z.object({version:z.literal(34),kind:z.literal('drivekey-owned-input-observation'),deviceId:z.string().uuid(),requestId:z.string().uuid(),fingerprint:hash,chain:z.enum(['ethereum','solana']),asset:z.enum(['ETH','SOL','USDC']),contextDigest:z.string().regex(/^[0-9a-f]{64}$/),snapshotFingerprint:z.string().regex(/^[0-9a-f]{64}$/),root:scalar,rootIndex:index,inputCount:z.number().int().min(1).max(6),totalInputBaseUnits:z.string().regex(/^[1-9][0-9]*$/).max(80),observedAt:z.string().datetime(),observations:z.array(chainObservation).length(2),selectedInputOwnershipVerified:z.literal(true),rootMembershipVerified:z.literal(true),currentUnspentObserved:z.literal(true),completeBalanceVerified:z.literal(false),ciphertextHistoryVerified:z.literal(false),spendabilityVerified:z.literal(false),eligibleForSigning:z.literal(false),circuitAuthorizationCreated:z.literal(false),blockchainTransactionSigned:z.literal(false),submitted:z.literal(false)}).strict();
export function validateOwnedInputObservation(request:unknown,input:unknown,now=Date.now(),fresh=true){
 const r=validateViewRequest(request,now,fresh),o=observationSchema.parse(input),at=Date.parse(o.observedAt),checkTime=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)>=Date.parse(r.createdAt)&&Date.parse(v)<=at&&(!fresh||now-Date.parse(v)<=120000);
 if(!Number.isSafeInteger(now)||o.deviceId!==r.deviceId||o.requestId!==r.requestId||o.fingerprint!==r.fingerprint||o.chain!==r.context.chain||o.asset!==privateViewInputAsset(r.context)||o.inputCount!==r.context.inputNotes.length||o.contextDigest!==createHash('sha256').update(canonical(r.context)).digest('hex')||BigInt(o.totalInputBaseUnits)<BigInt(r.context.amount)||at<Date.parse(r.createdAt)||at>=Date.parse(r.expiresAt)||at>now+60000||fresh&&now-at>120000)throw Error('Owned-input observation differs from its exact draft or lifetime.');
 const origins=o.observations.map(v=>{const u=new URL(String(v.origin));if(u.protocol!=='https:'||u.origin!==v.origin||v.chain!==o.chain||v.root!==o.root||v.rootIndex!==o.rootIndex||v.unspentInputCount!==o.inputCount||v.authorityGranted!==false||v.settled!==false||!checkTime(v.observedAt)||(v.chain==='ethereum'?v.pendingRechecked!==true:v.confirmedRechecked!==true))throw Error('Owned-input chain observations are missing, stale or inconsistent.');return u.origin;});if(new Set(origins).size!==2)throw Error('Owned-input observations require independent readers.');return o;
}
