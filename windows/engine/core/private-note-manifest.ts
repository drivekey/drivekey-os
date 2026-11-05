// Internal deterministic ownership manifest. Never grants signing authority.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {formatUnits} from 'ethers';
import {canonical,CHAINS} from './payment-intent';
import {validateProductProof} from './hinkal-product-proof';
import {HINKAL_SCALAR} from './hinkal-groth16';
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/).max(78),hash=z.string().regex(/^[0-9a-f]{64}$/),id=z.string().uuid(),fp=z.string().regex(/^0x[0-9a-f]{64}$/);
const inputSchema=z.object({commitment:uint,nullifier:uint,amount:uint,ciphertextHash:hash}).strict();
const schema=z.object({version:z.literal(1),kind:z.literal('drivekey-private-note-manifest'),deviceId:id,requestId:id,requestFingerprint:fp,walletHash:hash,chain:z.enum(['ethereum','solana']),asset:z.enum(['ETH','SOL','USDC']),token:z.string().max(44),action:z.enum(['deposit','withdraw','transfer','swap']),amount:uint,privateInputTotal:uint,expectedPrivateChange:uint,inputs:z.array(inputSchema).max(6),fingerprint:hash}).strict();
export type PrivateNoteManifest=z.infer<typeof schema>;
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
export const noteCiphertextHash=(text:string)=>sha('DriveKey private encrypted note v1\n'+text);
export function noteManifestFingerprint(input:any){const {fingerprint,...body}=input;return sha('DriveKey private note manifest v1\n'+canonical(body));}
export function createPrivateNoteManifest(request:unknown,inputs:unknown[],now=Date.now(),expiry=true){
 const r=validateProductProof(request,now,expiry),c:any=(r.seed as any).job.context,asset=c.action==='swap'?(c.tokenIn||c.asset):c.asset,notes=z.array(inputSchema).max(6).parse(inputs),total=notes.reduce((n,u)=>n+BigInt(u.amount),0n),change=total+(c.action==='deposit'?BigInt(c.amount):-BigInt(c.amount));
 if(change<0n)throw Error('Insufficient independently owned private notes.');const token=r.chain==='ethereum'?(asset==='USDC'?CHAINS.ethereum.usdc:'0x0000000000000000000000000000000000000000'):(asset==='USDC'?CHAINS.solana.usdc:'11111111111111111111111111111111');
 const m={version:1,kind:'drivekey-private-note-manifest',deviceId:r.deviceId,requestId:r.requestId,requestFingerprint:r.fingerprint,walletHash:sha(canonical(r.wallet)),chain:r.chain,asset,token,action:c.action,amount:c.amount,privateInputTotal:total.toString(),expectedPrivateChange:change.toString(),inputs:notes,fingerprint:''};m.fingerprint=noteManifestFingerprint(m);return validatePrivateNoteManifest(r,m,now,expiry);
}
export function validatePrivateNoteManifest(request:unknown,input:unknown,now=Date.now(),expiry=true){
 const r=validateProductProof(request,now,expiry),m=schema.parse(input),c:any=(r.seed as any).job.context,asset=c.action==='swap'?(c.tokenIn||c.asset):c.asset,token=r.chain==='ethereum'?(asset==='USDC'?CHAINS.ethereum.usdc:'0x0000000000000000000000000000000000000000'):(asset==='USDC'?CHAINS.solana.usdc:'11111111111111111111111111111111'),total=m.inputs.reduce((n,u)=>n+BigInt(u.amount),0n),change=total+(c.action==='deposit'?BigInt(c.amount):-BigInt(c.amount));
 if(m.fingerprint!==noteManifestFingerprint(m)||m.deviceId!==r.deviceId||m.requestId!==r.requestId||m.requestFingerprint!==r.fingerprint||m.walletHash!==sha(canonical(r.wallet))||m.chain!==r.chain||m.asset!==asset||m.token!==token||m.action!==c.action||m.amount!==c.amount||change<0n||m.privateInputTotal!==total.toString()||m.expectedPrivateChange!==change.toString()||m.inputs.length!==c.inputNotes.length||m.inputs.some((n,i)=>n.ciphertextHash!==noteCiphertextHash(c.inputNotes[i])||BigInt(n.amount)<=0n||BigInt(n.amount)>=(1n<<128n)||BigInt(n.commitment)<=0n||BigInt(n.commitment)>=HINKAL_SCALAR||BigInt(n.nullifier)<=0n||BigInt(n.nullifier)>=HINKAL_SCALAR)||new Set(m.inputs.map(n=>n.commitment)).size!==m.inputs.length||new Set(m.inputs.map(n=>n.nullifier)).size!==m.inputs.length)throw Error('Private-note manifest differs from its original wallet, inputs or exact amounts.');return m;
}
export function privateNoteReview(request:unknown,input:unknown,now=Date.now()){const m=validatePrivateNoteManifest(request,input,now),decimals=m.asset==='USDC'?6:m.asset==='ETH'?18:9;return {independentlyOwnedPrivateInputs:formatUnits(m.privateInputTotal,decimals)+' '+m.asset,privateInputTotalBaseUnits:m.privateInputTotal,expectedPrivateChange:formatUnits(m.expectedPrivateChange,decimals)+' '+m.asset,expectedPrivateChangeBaseUnits:m.expectedPrivateChange,reservedInputCount:String(m.inputs.length)};}
