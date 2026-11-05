// Provider networking with already-public circuit authorization only. No vault,
// password, viewing key, login signature or spending key is accepted here.
import {z} from 'zod';
import {canonical} from '../engine/core/payment-intent';
import {multiPublicSchema} from '../engine/core/multi-protocol';
import {HINKAL_PIN} from '../engine/core/hinkal-intent';
import {validateProductProof,verifyProductProofResponse} from '../engine/core/hinkal-product-proof';
import {providerProductFinalizingSupported,providerProofFromEnvelope} from '../engine/core/hinkal-provider-proof';
import {productAuthorizationHash,verifyProductProofResult} from '../engine/core/hinkal-product-result';
const {makeEnclaveHandshakeAndEncryptInput}=require('../node_modules/@hinkal/common/common/src/functions/utils/encryptInputForEnclave.cjs'),{httpClient}=require('../node_modules/@hinkal/common/common/src/data-structures/http/HttpClient.cjs');
const inputSchema=z.object({request:z.unknown(),response:z.unknown()}).strict();
async function finalize(profile:number,input:any){const sealed=await makeEnclaveHandshakeAndEncryptInput({jobId:input.jobId,eddsaSignature:input.authorization});try{return await httpClient.post(HINKAL_PIN.proofEndpoint+(profile===13?'/finalize-tx':'/finalize-solana-tx'),{key:sealed.keyCiphertext,inputs:sealed.inputCiphertext},{timeout:60000,maxContentLength:128*1024,maxBodyLength:128*1024});}finally{sealed.key.fill(0);}}
export async function finalizeProductProof(input:unknown,wallet:unknown,now=Date.now(),provider=finalize){
 const p=inputSchema.parse(structuredClone(input)),started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),r=validateProductProof(p.request,now),w=multiPublicSchema.parse(wallet);
 if(canonical(w)!==canonical(r.wallet)||!providerProductFinalizingSupported(r))throw Error('Provider finalization wallet or profile differs.');
 const auth=await verifyProductProofResponse(r,p.response,clock()),seed:any=r.seed,circuit:any=auth.proofAuthorization,finalizationStartedAt=new Date(clock()).toISOString();validateProductProof(r,clock());
 const envelope=await provider(seed.version,{context:structuredClone(seed.job.context),jobId:circuit.jobId,authorization:structuredClone(circuit.authorization)}),proof=providerProofFromEnvelope(seed,envelope),result={version:28,kind:'drivekey-hinkal-product-proof-result',deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,authorizationHash:productAuthorizationHash(auth),createdAt:new Date(clock()).toISOString(),finalizationStartedAt,chain:r.chain,proof,blockchainTransactionSigned:false,submitted:false};
 // A completed genuine proof is preserved when delivery crosses expiry. New
 // finalizations and every later chain-signing admission still check expiry.
 return verifyProductProofResult(r,auth,result,clock(),false);
}
