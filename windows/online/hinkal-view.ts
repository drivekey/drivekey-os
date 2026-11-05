// Network process: holds a scoped view capability and transport decryption key,
// never the wallet vault, login signature, spending key or circuit signature.
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {canonical} from '../engine/core/payment-intent';
import {validateViewRequest,assertViewWallet,verifyViewResponse} from '../engine/core/hinkal-view';
import {openPrivateView} from '../engine/core/hinkal-view-crypto';
import {hinkalProofFingerprint} from '../engine/core/hinkal-proof-job';
import {hinkalSolanaProofFingerprint} from '../engine/core/hinkal-solana-proof-job';
import {createProductProof} from '../engine/core/hinkal-product-proof';
import {prepareHinkalProof} from './hinkal-proof';
import {prepareHinkalSolanaProof} from './hinkal-solana-proof';
const schema=z.object({request:z.unknown(),response:z.unknown(),transportPrivateKey:z.string().length(64)}).strict();
const prepare=(profile:number,input:any)=>profile===13?prepareHinkalProof(input):prepareHinkalSolanaProof(input);
export async function prepareScopedViewJob(input:unknown,wallet:unknown,now=Date.now(),provider=prepare){
 const p=schema.parse(JSON.parse(JSON.stringify(input))),r=validateViewRequest(p.request,now);assertViewWallet(r,wallet);const response=verifyViewResponse(r,p.response,now);
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started);let view:any;
 try{view=openPrivateView(r,response.sealed,p.transportPrivateKey);p.transportPrivateKey='';
  const key=view.nullifyingKey,decimal=BigInt(key).toString(),publicKey:[string,string]=view.spendingPublicKey;
  const job=await provider(r.profile,{context:structuredClone(r.context),view:{chain:view.chain,address:view.address,nullifyingKey:key,spendingPublicKey:[...publicKey],readOnly:true,testOnly:true}});
  validateViewRequest(r,clock());const serialized=JSON.stringify(job,(_k,v)=>typeof v==='bigint'?v.toString():v);
  if(Buffer.byteLength(serialized)>64*1024||serialized.toLowerCase().includes(key.toLowerCase())||serialized.includes(decimal)||canonical(job.context)!==canonical(r.context))throw Error('Provider job scope or public output differs.');
  const createdAt=new Date(clock()).toISOString(),seed:any={version:r.profile,kind:r.profile===13?'hinkal-offline-proof-authorization':'hinkal-solana-offline-proof-authorization',testOnly:true,requestId:randomUUID(),deviceId:r.deviceId,createdAt,expiresAt:r.expiresAt,maximumFee:r.maximumFee,job:JSON.parse(serialized),...(r.profile===13?{nonce:r.nonce}:{maximumAccountRent:r.maximumAccountRent})};
  seed.fingerprint=r.profile===13?hinkalProofFingerprint(seed):hinkalSolanaProofFingerprint(seed);
  const productRequest=createProductProof(seed,r.wallet,publicKey,clock());
  return {version:30,kind:'drivekey-hinkal-view-preparation',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,productRequest,blockchainTransactionSigned:false,submitted:false};
 }finally{p.transportPrivateKey='';if(view){view.nullifyingKey=undefined;view=undefined;}}
}
