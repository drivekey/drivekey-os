import {hkdfSync,createHash} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import {z} from 'zod';
import {unlockMultiVault} from './multi-vault';
import {retainedSolSecret,wipeSolSecret} from './sol-secret';
const schema=z.object({requestId:z.string().uuid(),deviceId:z.string().uuid(),from:z.string().max(44)}).strict();
export type CctpAuxiliaryScope=z.infer<typeof schema>;
// Domain-separated auxiliary account, never a second wallet funding source.
// The request UUID exists before its auxiliary public key and final fingerprint,
// avoiding recursive key derivation. No raw auxiliary secret is serialized.
export async function withCctpAuxiliary<T>(vault:any,password:string,input:unknown,callback:(aux:Keypair,source:Keypair,scope:CctpAuxiliaryScope)=>Promise<T>):Promise<T>{
 const scope=schema.parse(input);if(scope.deviceId!==vault?.public?.deviceId||scope.from!==vault.public.solanaAddress||!PublicKey.isOnCurve(new PublicKey(scope.from).toBytes()))throw Error('CCTP auxiliary derivation belongs to another wallet.');const keys=await unlockMultiVault(vault,password);let seed:Buffer|undefined,aux:Keypair|undefined;try{if(keys.sol.publicKey.toBase58()!==scope.from)throw Error('CCTP source secret differs from public identity.');const salt=createHash('sha256').update('DriveKey CCTP auxiliary scope v1\n'+scope.deviceId+'\n'+scope.requestId+'\n'+scope.from).digest();seed=Buffer.from(hkdfSync('sha256',retainedSolSecret(keys.sol).subarray(0,32),salt,Buffer.from('DriveKey disposable CCTP message account signer v1'),32));aux=Keypair.fromSeed(seed);seed.fill(0);return await callback(aux,keys.sol,scope);}finally{seed?.fill(0);if(aux)wipeSolSecret(aux);wipeSolSecret(keys.sol);}
}
export async function deriveCctpAuxiliaryPublic(vault:any,password:string,input:unknown){return withCctpAuxiliary(vault,password,input,async(aux,_source,scope)=>({version:1,kind:'cctp-message-account-public-key',requestId:scope.requestId,deviceId:scope.deviceId,source:scope.from,auxiliaryPublicKey:aux.publicKey.toBase58(),financialTransactionSigned:false}));}
