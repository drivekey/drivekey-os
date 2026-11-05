// Offline, bounded public-history inspection. No view key or login signature
// leaves this child. Candidate notes never grant proof or transaction authority.
import {createHash} from 'node:crypto';
import {canonical,CHAINS} from '../core/payment-intent';
import {multiPublicSchema} from '../core/multi-protocol';
import {HINKAL_PIN} from '../core/hinkal-intent';
import {verifyPublicNotePage} from '../core/hinkal-note-snapshot';
import {HINKAL_MERKLE_FIELD} from '../core/hinkal-local-merkle';
import {ownHinkalEvmNote} from '../core/hinkal-evm-note';
import {ownHinkalSolanaNote} from '../core/hinkal-solana-proof-job';
import {unlockMultiVault} from './multi-vault';
import {identity as solanaIdentity} from './hinkal-solana-proof';
import {wipeSolSecret} from './sol-secret';
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs');
export async function inspectPublicNotePage(vault:any,password:string,wallet:unknown,manifest:unknown,page:unknown){
 const expected=multiPublicSchema.parse(structuredClone(wallet));if(canonical(expected)!==canonical(vault?.public))throw Error('Private note inspection wallet changed.');const checked=await verifyPublicNotePage(structuredClone(manifest),structuredClone(page)),keys=await unlockMultiVault(vault,password);
 try{await preProcessing();if(keys.evm.address!==expected.evmAddress||keys.sol.publicKey.toBase58()!==expected.solanaAddress)throw Error('Private note inspection keys differ from the wallet.');const user=checked.manifest.chain==='ethereum'?new UserKeys(await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage)):solanaIdentity(keys),assets=checked.manifest.chain==='ethereum'?['ETH','USDC'] as const:['SOL','USDC'] as const,ownedNotes:any[]=[];
  for(const leaf of checked.page.leaves)for(const asset of assets){let note:any;try{note=checked.manifest.chain==='ethereum'?ownHinkalEvmNote(leaf.encryptedOutput,user,asset==='USDC'?CHAINS.ethereum.usdc:'0x0000000000000000000000000000000000000000'):ownHinkalSolanaNote(leaf.encryptedOutput,user,asset as 'SOL'|'USDC');}catch{continue;}
   const commitment=BigInt(note.getCommitment()).toString(),nullifier=BigInt(note.getNullifier()).toString(),amount=BigInt(note.amount);if(commitment!==leaf.path.commitment)throw Error('Owned encrypted note does not match its public commitment.');if(amount<=0n||amount>=(1n<<128n)||BigInt(nullifier)<=0n||BigInt(nullifier)>=HINKAL_MERKLE_FIELD)throw Error('Owned note amount or nullifier is outside its supported range.');ownedNotes.push({index:leaf.path.index,commitment,nullifier,asset,amount:amount.toString(),encryptedOutput:leaf.encryptedOutput,...leaf.encryptedBlob?{encryptedBlob:leaf.encryptedBlob}:{},providerMarkedBlocked:leaf.providerMarkedBlocked,rootMembershipVerified:true,ciphertextHistoryVerified:false,unspentVerified:false,eligibleForSigning:false});break;
  }
  return {version:31,kind:'drivekey-hinkal-owned-note-candidates',deviceId:expected.deviceId,walletHash:createHash('sha256').update(canonical(expected)).digest('hex'),snapshotFingerprint:checked.manifest.fingerprint,pageIndex:checked.page.index,inspectedLeafCount:checked.page.leaves.length,ownedNotes,duplicateOwnedIdentitiesInPage:new Set(ownedNotes.map(n=>n.nullifier)).size<ownedNotes.length,rootMembershipVerified:true,ciphertextHistoryVerified:false,spendabilityVerified:false,circuitAuthorizationCreated:false,blockchainTransactionSigned:false,submitted:false};
 }finally{wipeSolSecret(keys.sol);}
}
