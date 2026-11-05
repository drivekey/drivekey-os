import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {withCctpAuxiliary} from './cctp-auxiliary';
import {retainedSolSecret} from './sol-secret';
import {signCctpSolanaV1,decodeCctpSolanaV1} from '../core/cctp-solana-v1';
import {validateMayanSolana,assertMayanSolanaWallet,mayanSolanaApproval,verifyMayanSolanaResponse} from '../core/mayan-solana-intent';
export async function signMayanSolana(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateMayanSolana(JSON.parse(JSON.stringify(input)),now);assertMayanSolanaWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Bridge fingerprint changed after review.');const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start);
 return withCctpAuxiliary(vault,password,{requestId:r.requestId,deviceId:r.deviceId,from:r.from},async(aux,source)=>{if(aux.publicKey.toBase58()!==r.auxiliary)throw Error('Bridge auxiliary signer differs from the locally derived request account.');validateMayanSolana(r,clock());const rawSignedTransaction=signCctpSolanaV1(r.unsignedTransaction,r.from,r.auxiliary,retainedSolSecret(source),retainedSolSecret(aux)),v=decodeCctpSolanaV1(rawSignedTransaction,r.from,r.auxiliary,false);return verifyMayanSolanaResponse({version:23,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(clock()).toISOString(),rawSignedTransaction,transactionHash:bs58.encode(v.tx.signatures[r.from as keyof typeof v.tx.signatures]!),approvalSignature:bs58.encode(nacl.sign.detached(mayanSolanaApproval(r),retainedSolSecret(source)))},r,vault.public,clock());});
}
