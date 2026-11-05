import {z} from 'zod';
import {keccak256} from 'ethers';
import {canonical} from './payment-intent';
import {validateProductProof,verifyProductProofResponse} from './hinkal-product-proof';
import {HINKAL_PROVER_PINS} from './hinkal-prover-pins';
import {inspectHinkalEvmSwapProof} from './hinkal-evm-swap-intent';
import {verifyHinkalEvmGroth16} from './hinkal-evm-groth16';
import {verifyHinkalSolanaGroth16} from './hinkal-solana-groth16';
import {buildHinkalSolanaSwapWire} from './hinkal-solana-swap-wire';
const hash=z.string().regex(/^0x[0-9a-f]{64}$/),uint=z.string().regex(/^(0|[1-9][0-9]*)$/).max(78),byte=z.number().int().min(0).max(255);
const flags={proofAuthorizationProvided:z.literal(true),blockchainTransactionSigned:z.literal(false),submitted:z.literal(false),localProof:z.literal(true),provingArtifacts:z.array(z.string().regex(/^[0-9a-f]{64}$/)).length(2)};
const evmProof=z.object({data:z.string().regex(/^0x[0-9a-f]+$/).max(40000),...flags}).strict();
const solanaProof=z.object({solanaArgs:z.object({dimensions:z.object({tokenNumber:z.literal(2),nullifierAmount:z.literal(2),outputAmount:z.literal(1)}).strict(),
 proofAArr:z.array(byte).length(64),proofBArr:z.array(byte).length(128),proofCArr:z.array(byte).length(64),
 publicInputsArr:z.array(z.array(byte).length(32)).length(23),encryptedOutputs:z.array(z.array(byte).max(2048)).length(2),rootHashIndex:uint}).strict(),...flags}).strict();
const schema=z.object({version:z.literal(28),kind:z.literal('drivekey-hinkal-product-proof-result'),deviceId:z.string().uuid(),requestId:z.string().uuid(),
 fingerprint:hash,authorizationHash:hash,createdAt:z.string().datetime(),chain:z.enum(['ethereum','solana']),proof:z.unknown(),blockchainTransactionSigned:z.literal(false),submitted:z.literal(false)}).strict();
export type ProductProofResult=z.infer<typeof schema>;
export const productAuthorizationHash=(response:unknown)=>keccak256(Buffer.from(canonical(response)));
export function localProductProvingSupported(request:any){return [19,20,27].includes(request?.seed?.version);}
export async function verifyProductProofResult(request:unknown,response:unknown,input:unknown,now=Date.now(),expiry=true){
 const r=validateProductProof(request,now,expiry),auth=await verifyProductProofResponse(r,response,now,expiry),result=schema.parse(input),at=Date.parse(result.createdAt),seed:any=r.seed;
 if(!localProductProvingSupported(r)||result.deviceId!==r.deviceId||result.requestId!==r.requestId||result.fingerprint!==r.fingerprint||result.chain!==r.chain||
    result.authorizationHash!==productAuthorizationHash(auth)||at<Date.parse(auth.signedAt)||at>=Date.parse(r.expiresAt)||at>now+60000||Buffer.byteLength(JSON.stringify(result))>64*1024)
  throw Error('Private proof result differs from its approved request.');
 const proof=r.chain==='ethereum'?evmProof.parse(result.proof):solanaProof.parse(result.proof);
 if(canonical(proof.provingArtifacts)!==canonical(Object.values(HINKAL_PROVER_PINS[r.chain]).map(p=>p.sha256)))throw Error('Private proof used different proving artifacts.');
 if('data' in proof){inspectHinkalEvmSwapProof(seed,proof.data);await verifyHinkalEvmGroth16(proof.data,seed.job.response.signedMessageHash);}
 else{
  const publicSignals=proof.solanaArgs.publicInputsArr.map(bytes=>BigInt('0x'+Buffer.from(bytes).toString('hex')).toString());
  if(canonical(publicSignals)!==canonical(seed.job.response.publicSignals))throw Error('Private Solana proof public signals differ from the authorization.');
  buildHinkalSolanaSwapWire(seed,proof.solanaArgs);await verifyHinkalSolanaGroth16(proof.solanaArgs);
 }
 return {...result,proof};
}
