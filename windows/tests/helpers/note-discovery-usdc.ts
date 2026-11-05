// Test-only, one SDK instance. No keys or login signatures leave this fixture.
import {AbiCoder} from 'ethers';
import {PublicKey} from '@solana/web3.js';
import {unlockMultiVault} from '../../engine/offline-signer/multi-vault';
import {wipeSolSecret} from '../../engine/offline-signer/sol-secret';
import {identity as solanaIdentity} from '../../engine/offline-signer/hinkal-solana-proof';
import {inspectPublicNotePage} from '../../engine/offline-signer/hinkal-note-discovery';
import {HINKAL_PIN} from '../../engine/core/hinkal-intent';
import {HINKAL_EVM_ONCHAIN_TYPES} from '../../engine/core/hinkal-evm-note';
import {solanaHinkalCompressed} from '../../engine/core/hinkal-solana-proof-job';
import {CHAINS} from '../../engine/core/payment-intent';
import {normalizePublicNoteSnapshot} from '../../engine/core/hinkal-note-snapshot';
import {prepareHinkalMerkleMath,bootstrapHinkalMerkle,appendHinkalMerkle,HINKAL_MERKLE_MIN} from '../../engine/core/hinkal-local-merkle';
const {UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs'),{Utxo}=require('../../node_modules/@hinkal/common/common/src/data-structures/utxo/Utxo.cjs'),{encryptUtxo}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/encryptDecryptUtxo.cjs'),math=require('../../node_modules/@hinkal/common/common/src/functions/snarkjs/common.snarkjs.cjs'),{encodeSolanaOnChainUtxo}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/decodeUTXO.cjs');
export async function usdcDiscovery(vault:any,password:string,chain:'ethereum'|'solana'){
 await prepareHinkalMerkleMath();const keys=await unlockMultiVault(vault,password);
 try{const user=chain==='ethereum'?new UserKeys(await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage)):solanaIdentity(keys),nk=user.getShieldedPrivateKey(),point=user.getSpendingKeyPair().pubSpendingBJJPoint,note=new Utxo({amount:1000001n,erc20TokenAddress:chain==='ethereum'?CHAINS.ethereum.usdc:solanaHinkalCompressed(CHAINS.solana.usdc),...chain==='solana'?{mintAddress:CHAINS.solana.usdc}:{},timeStamp:String(Math.floor(Date.now()/1000)),nullifyingKey:nk,spendingPublicKey:point,randomization:UserKeys.findCorrectRandomization(123456n,nk)}),shape=math.calcStealthAddressStructureFromH0(note.H0,nk,point),sealed=math.calcOnchainEncryptedOutput(UserKeys.getEncryptionKeyPair(nk).publicKey,shape),normal='0x'+Buffer.from(encryptUtxo(note)).toString('hex');let onChain;
  if(chain==='ethereum')onChain=AbiCoder.defaultAbiCoder().encode(HINKAL_EVM_ONCHAIN_TYPES,[[note.amount,note.erc20TokenAddress,[shape.H0x,shape.H0y,shape.H1x,shape.H1y,shape.stealthAddress],note.timeStamp],sealed]);else{const mint=new PublicKey(CHAINS.solana.usdc).toBuffer(),values=[note.amount,BigInt('0x'+mint.subarray(0,16).toString('hex')),BigInt('0x'+mint.subarray(16).toString('hex')),shape.H0x,shape.H0y,shape.H1x,shape.H1y,BigInt(shape.stealthAddress),BigInt(note.timeStamp)];onChain=encodeSolanaOnChainUtxo(values.map(n=>Array.from(Buffer.from(BigInt(n).toString(16).padStart(64,'0'),'hex'))));}
  const tree=bootstrapHinkalMerkle({mIndex:HINKAL_MERKLE_MIN.toString(),root:'0',frontier:Array(26).fill('0')}),commitment=BigInt(note.getCommitment()).toString();appendHinkalMerkle(tree,[{index:HINKAL_MERKLE_MIN.toString(),commitment}]);const results=[];
  for(const [value,positive]of [[normal,true],[onChain,false]] as const){const raw=JSON.parse(JSON.stringify({latestBlockNumber:1,merkleTree:tree.toJSON(),encryptedOutputs:[{value,isPositive:String(positive),isBlocked:false,...!positive&&chain==='solana'?{encryptedBlob:sealed}:{}}],encryptedOutputsByCommitment:[{commitment,encryptedOutput:value}]},(_k,v)=>typeof v==='bigint'?v.toString():v)),snapshot=await normalizePublicNoteSnapshot(chain,raw);results.push({format:positive?'encrypted':'on-chain',response:await inspectPublicNotePage(vault,password,vault.public,snapshot.manifest,snapshot.pages[0])});}return {chain,expectedAmount:'1000001',results};
 }finally{wipeSolSecret(keys.sol);}
}
