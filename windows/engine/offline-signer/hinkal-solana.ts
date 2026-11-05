import {VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret,retainedSolSecret} from './sol-secret';
import {HINKAL_PIN} from '../core/hinkal-intent';
import {validateHinkalSolana,assertHinkalSolanaWallet,inspectHinkalSolana,hinkalSolanaApproval,verifyHinkalSolanaResponse} from '../core/hinkal-solana-intent';
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs'),{decryptSealedKeys}=require('../../node_modules/@hinkal/common/common/src/crypto/ecdh-sealed-keys.cjs');
export async function signHinkalSolana(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateHinkalSolana(JSON.parse(JSON.stringify(input)),now);assertHinkalSolanaWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Hinkal Solana fingerprint changed after review.');const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);let login:Uint8Array|undefined;
 try{await preProcessing();validateHinkalSolana(r,clock());const v=inspectHinkalSolana(r);login=nacl.sign.detached(Buffer.from(HINKAL_PIN.sdkLoginMessage),retainedSolSecret(keys.sol));const identity=new UserKeys('0x'+Buffer.from(login).toString('hex')),nk=identity.getShieldedPrivateKey(),h1=UserKeys.getH1FromH0(v.shape.H0,nk),stealth=UserKeys.getStealthAddress(v.shape.H0,nk,identity.getSpendingKeyPair().pubSpendingBJJPoint),pair=UserKeys.getEncryptionKeyPair(nk),plain=Buffer.from(decryptSealedKeys(v.encryptedBlob,pair.privateKey,pair.publicKey,0));
  try{const fields=plain.toString('utf8').split('0x').filter(Boolean);if(h1.some((n:bigint,i:number)=>n!==v.shape.H1[i])||BigInt(stealth)!==v.shape.stealthAddress||fields.length!==2||('0x'+fields[0]).toLowerCase()!==pair.publicKey.toLowerCase()||BigInt('0x'+fields[1])!==v.shape.stealthAddress)throw Error('Hinkal Solana private deposit output belongs to another identity.');}finally{plain.fill(0);login.fill(0);}
  const approvalSignature=bs58.encode(nacl.sign.detached(hinkalSolanaApproval(r),retainedSolSecret(keys.sol))),signingAt=clock();validateHinkalSolana(r,signingAt);const tx=VersionedTransaction.deserialize(Buffer.from(r.unsignedTransaction,'base64'));tx.sign([keys.sol]);return verifyHinkalSolanaResponse({version:14,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(signingAt).toISOString(),rawSignedTransaction:Buffer.from(tx.serialize()).toString('base64'),transactionHash:bs58.encode(tx.signatures[0]),approvalSignature},r,vault.public,clock(),false);
 }finally{login?.fill(0);wipeSolSecret(keys.sol);}
}
