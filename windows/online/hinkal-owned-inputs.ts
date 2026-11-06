// Network-only observation of the exact inputs in an already approved view
// draft. No spend key, proof permission, chain signature or balance authority.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {OnlineAdapter} from './adapter';
import {strictPublicHistoryJSON} from './hinkal-note-history';
import {canonical,CHAINS} from '../engine/core/payment-intent';
import {validateViewRequest,assertViewWallet,verifyViewResponse,privateViewInputAsset} from '../engine/core/hinkal-view';
import {openPrivateView} from '../engine/core/hinkal-view-crypto';
import {validatePublicNoteSnapshot,verifyPublicNotePage} from '../engine/core/hinkal-note-snapshot';
import {ownHinkalEvmNote} from '../engine/core/hinkal-evm-note';
import {ownHinkalSolanaNote} from '../engine/core/hinkal-solana-proof-job';
import {verifyHinkalEvmPrivateState,verifyHinkalSolanaPrivateState} from './hinkal-private-state';
import {validateOwnedInputObservation} from '../engine/core/hinkal-view';
const {preProcessing}=require('../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs');
const schema=z.object({request:z.unknown(),response:z.unknown(),transportPrivateKey:z.string().length(64),witness:z.object({manifest:z.unknown(),pages:z.array(z.unknown()).min(1).max(6)}).strict()}).strict();
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function privateInputReaders(chain:'ethereum'|'solana'){const urls=chain==='ethereum'?['https://0xrpc.io/eth','https://eth.rpc.blxrbdn.com']:['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'];return urls.map(url=>new OnlineAdapter({[chain]:url},strictPublicHistoryJSON));}
export async function observeOwnedViewInputs(input:unknown,wallet:unknown,adapters:OnlineAdapter[],now=Date.now()){
 if(!input||Buffer.byteLength(JSON.stringify(input))>1024*1024)throw Error('Owned-input request exceeds its bounded format.');
 const p=schema.parse(structuredClone(input)),r=validateViewRequest(p.request,now);assertViewWallet(r,wallet);const response=verifyViewResponse(r,p.response,now),m=validatePublicNoteSnapshot(p.witness.manifest),c=r.context,asset=privateViewInputAsset(c);
 if(m.chain!==c.chain||!c.inputNotes.length||new Set(c.inputNotes).size!==c.inputNotes.length||!Array.isArray(adapters)||adapters.length!==2)throw Error('Choose distinct private inputs and two independent chain readers.');
 const origins=adapters.map(a=>{const raw=a.endpoints[c.chain];if(typeof raw!=='string')throw Error('Missing private-state reader.');const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Private-state readers require independent HTTPS origins.');return u.origin;});if(new Set(origins).size!==2)throw Error('Private-state readers require independent HTTPS origins.');
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),leaves:any[]=[],indices=new Set<number>();let view:any;
 try{
  // Verify every supplied public path before decrypting any viewing capability.
  for(const page of p.witness.pages){const checked=await verifyPublicNotePage(m,page);if(indices.has(checked.page.index))throw Error('Duplicate owned-input witness page.');indices.add(checked.page.index);if(!checked.page.leaves.some(l=>c.inputNotes.includes(l.encryptedOutput)))throw Error('Owned-input witness contains an unrelated page.');leaves.push(...checked.page.leaves);}
  validateViewRequest(r,clock());view=openPrivateView(r,response.sealed,p.transportPrivateKey);p.transportPrivateKey='';await preProcessing();
  const key={getShieldedPrivateKey:()=>view.nullifyingKey,getSpendingKeyPair:()=>({pubSpendingBJJPoint:view.spendingPublicKey.map(BigInt)}),signEddsa:()=>{throw Error('Offline proof authorization required.');}},notes=[];
  for(const cipher of c.inputNotes){const matches=leaves.filter(l=>l.encryptedOutput===cipher);if(matches.length!==1||matches[0].providerMarkedBlocked)throw Error('Selected input is missing, duplicated or provider-blocked.');const note=c.chain==='ethereum'?ownHinkalEvmNote(cipher,key,asset==='USDC'?CHAINS.ethereum.usdc:'0x0000000000000000000000000000000000000000'):ownHinkalSolanaNote(cipher,key,asset as 'SOL'|'USDC'),commitment=BigInt(note.getCommitment()).toString(),nullifier=BigInt(note.getNullifier()).toString(),amount=BigInt(note.amount);
   if(commitment!==matches[0].path.commitment||amount<=0n||amount>=(c.chain==='solana'?1n<<64n:1n<<128n)||commitment==='0'||nullifier==='0')throw Error('Selected input ownership, amount or commitment differs.');notes.push({commitment,nullifier,amount:amount.toString()});}
  if(new Set(notes.map(n=>n.commitment)).size!==notes.length||new Set(notes.map(n=>n.nullifier)).size!==notes.length)throw Error('Selected inputs contain aliased commitment or nullifier identities.');
  const total=notes.reduce((s,n)=>s+BigInt(n.amount),0n);if(total<BigInt(c.amount))throw Error('Insufficient independently owned input amount.');
  const observations=[];for(let i=0;i<adapters.length;i++){validateViewRequest(r,clock());const seen=c.chain==='ethereum'?await verifyHinkalEvmPrivateState(adapters[i],m.root,m.rootIndex,notes.map(n=>n.nullifier),clock()):await verifyHinkalSolanaPrivateState(adapters[i],m.root,m.rootIndex,notes.map(n=>n.nullifier),clock());observations.push({origin:origins[i],...seen});}
  const result={version:34,kind:'drivekey-owned-input-observation',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,chain:c.chain,asset,contextDigest:digest(c),snapshotFingerprint:m.fingerprint,root:m.root,rootIndex:m.rootIndex,inputCount:notes.length,totalInputBaseUnits:total.toString(),observedAt:new Date(clock()).toISOString(),observations,selectedInputOwnershipVerified:true,rootMembershipVerified:true,currentUnspentObserved:true,completeBalanceVerified:false,ciphertextHistoryVerified:false,spendabilityVerified:false,eligibleForSigning:false,circuitAuthorizationCreated:false,blockchainTransactionSigned:false,submitted:false};
  validateViewRequest(r,clock());return validateOwnedInputObservation(r,result,clock());
 }finally{p.transportPrivateKey='';if(view){view.nullifyingKey=undefined;view=undefined;}}
}
