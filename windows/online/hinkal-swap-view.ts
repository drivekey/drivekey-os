// Isolated, read-capability-only construction. No vault, password, circuit
// authorization or chain signer is accepted by this preparation boundary.
import {randomBytes,randomUUID} from 'node:crypto';
import {canonical,CHAINS} from '../engine/core/payment-intent';
import {validateViewRequest,verifyViewResponse,privateViewSwapWitness,validateOwnedInputObservation} from '../engine/core/hinkal-view';
import {openPrivateView} from '../engine/core/hinkal-view-crypto';
import {validatePublicNoteSnapshot,verifyPublicNotePage} from '../engine/core/hinkal-note-snapshot';
import {hinkalLocalEvmSwapFingerprint} from '../engine/core/hinkal-local-evm-swap';
import {hinkalLocalSolanaSwapFingerprint} from '../engine/core/hinkal-local-solana-swap';
import {prepareLocalHinkalEvmSwap} from '../engine/offline-signer/hinkal-local-evm-swap';
import {prepareLocalHinkalSolanaSwap} from '../engine/offline-signer/hinkal-local-solana-swap';
import {createProductProof} from '../engine/core/hinkal-product-proof';
import {observeOwnedViewInputs,privateInputReaders} from './hinkal-owned-inputs';
import type {OnlineAdapter} from './adapter';
export type SwapViewDependencies={adapters?:OnlineAdapter[],construct?:(profile:number,input:any)=>Promise<any>};
export async function prepareScopedLocalSwap(p:any,wallet:unknown,now:number,deps:SwapViewDependencies={}){
 const r=validateViewRequest(p.request,now),response=verifyViewResponse(r,p.response,now),w=privateViewSwapWitness(r,p.witness,now),m=validatePublicNoteSnapshot(p.witness.manifest),started=performance.now(),clock=()=>now+Math.floor(performance.now()-started);let view:any;
 try{
  // Untrusted public witness mathematics precede any capability decryption.
  for(const page of p.witness.pages)await verifyPublicNotePage(m,page);
  validateViewRequest(r,clock());const observation=await observeOwnedViewInputs({request:r,response,transportPrivateKey:p.transportPrivateKey,witness:p.witness},wallet,deps.adapters??privateInputReaders(r.context.chain),clock());
  validateViewRequest(r,clock());validateOwnedInputObservation(r,observation,clock());
  view=openPrivateView(r,response.sealed,p.transportPrivateKey);p.transportPrivateKey='';const key=view.nullifyingKey,decimal=BigInt(key).toString(),publicKey:[string,string]=view.spendingPublicKey;
  const input={context:structuredClone(r.context),merkleWitness:w,view:{chain:view.chain,address:view.address,nullifyingKey:key,spendingPublicKey:[...publicKey],readOnly:true,testOnly:true}},job=await(deps.construct??((profile,input)=>profile===19?prepareLocalHinkalEvmSwap(input):prepareLocalHinkalSolanaSwap(input)))(r.profile,input);
  const serialized=JSON.stringify(job,(_k,v)=>typeof v==='bigint'?v.toString():v);if(Buffer.byteLength(serialized)>64*1024||serialized.toLowerCase().includes(key.toLowerCase())||serialized.includes(decimal)||canonical(job.context)!==canonical(r.context)||canonical(job.merkleWitness)!==canonical(w))throw Error('Private swap job scope, public witness or capability boundary differs.');
  validateViewRequest(r,clock());const createdAt=new Date(clock()).toISOString(),seed:any={version:r.profile,kind:r.profile===19?'hinkal-local-evm-swap-authorization':'hinkal-local-solana-swap-authorization',testOnly:true,requestId:randomUUID(),deviceId:r.deviceId,createdAt,expiresAt:r.expiresAt,maximumFee:r.maximumFee,job:JSON.parse(serialized)};
  if(r.profile===19){seed.nonce=r.nonce;seed.fingerprint=hinkalLocalEvmSwapFingerprint(seed);}else{
   const positions=observation.observations.map(o=>(o as any).merkleMIndex);if(positions.some(n=>typeof n!=='string')||positions[0]!==positions[1]||BigInt(positions[0])<=BigInt(w.rootIndex))throw Error('Independent current Solana Merkle positions differ. Preserve the original draft.');
   Object.assign(seed,{maximumAccountRent:r.maximumAccountRent,blockhashBinding:'at-chain-signing',genesisHash:CHAINS.solana.genesis,stagingId:randomBytes(4).readUInt32LE(0),merkleMIndex:positions[1]});seed.fingerprint=hinkalLocalSolanaSwapFingerprint(seed);
  }
  const productRequest=createProductProof(seed,r.wallet,publicKey,clock());validateViewRequest(r,clock());return {version:30,kind:'drivekey-hinkal-view-preparation',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,productRequest,inputObservation:observation,blockchainTransactionSigned:false,submitted:false};
 }finally{p.transportPrivateKey='';if(view){view.nullifyingKey=undefined;view=undefined;}}
}
