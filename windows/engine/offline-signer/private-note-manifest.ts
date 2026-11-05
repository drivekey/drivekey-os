// No network, circuit authorization, product approval or transaction signature.
// The fixed wallet login derives the existing Hinkal identity inside this child.
import {canonical,CHAINS} from '../core/payment-intent';
import {validateProductProof} from '../core/hinkal-product-proof';
import {createPrivateNoteManifest,noteCiphertextHash} from '../core/private-note-manifest';
import {HINKAL_PIN} from '../core/hinkal-intent';
import {ownHinkalEvmNote} from '../core/hinkal-evm-note';
import {ownHinkalSolanaNote} from '../core/hinkal-solana-proof-job';
import {assertProductPackageWallet} from '../core/hinkal-product-admission';
import {identity as solanaIdentity,verifyHinkalSolanaProofOwnership} from './hinkal-solana-proof';
import {verifyHinkalEvmProofOwnership} from './hinkal-proof';
import {verifyOwnedLocalHinkalSwap} from './hinkal-local-evm-swap';
import {constructLocalHinkalSolanaSwap} from './hinkal-local-solana-swap';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret} from './sol-secret';
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs');
export async function inspectProductNotesWithKeys(request:any,keys:any,now=Date.now()){
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),r=validateProductProof(request,now),seed:any=r.seed,c:any=seed.job.context;await preProcessing();const user=r.chain==='ethereum'?new UserKeys(await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage)):solanaIdentity(keys),point=user.getSpendingKeyPair().pubSpendingBJJPoint.map(String);
 if(canonical(point)!==canonical(r.expectedSpendingPublicKey)||r.chain==='ethereum'&&keys.evm.address!==r.wallet.evmAddress||r.chain==='solana'&&keys.sol.publicKey.toBase58()!==r.wallet.solanaAddress)throw Error('Private-note spending identity differs from its original wallet.');
 if(seed.version===13)verifyHinkalEvmProofOwnership(seed,user,clock);else if(seed.version===15)verifyHinkalSolanaProofOwnership(seed,user,clock);else if(seed.version===19)verifyOwnedLocalHinkalSwap(seed,user,clock);else constructLocalHinkalSolanaSwap(seed,user,true,clock);
 const asset=c.action==='swap'?(c.tokenIn||c.asset):c.asset,token=r.chain==='ethereum'?(asset==='USDC'?CHAINS.ethereum.usdc:'0x0000000000000000000000000000000000000000'):asset;
 const notes=c.inputNotes.map((ciphertext:string)=>{const note=r.chain==='ethereum'?ownHinkalEvmNote(ciphertext,user,token):ownHinkalSolanaNote(ciphertext,user,asset);return {commitment:BigInt(note.getCommitment()).toString(),nullifier:BigInt(note.getNullifier()).toString(),amount:note.amount.toString(),ciphertextHash:noteCiphertextHash(ciphertext)};});return createPrivateNoteManifest(r,notes,clock());
}
export async function inspectProductNotes(vault:any,password:string,input:unknown,now=Date.now()){
 const r=validateProductProof(structuredClone(input),now);assertProductPackageWallet(r,vault.public);const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started),keys=await unlockMultiVault(vault,password);
 try{validateProductProof(r,clock());const result=await inspectProductNotesWithKeys(r,keys,clock());validateProductProof(r,clock());return result;}finally{wipeSolSecret(keys.sol);}
}
