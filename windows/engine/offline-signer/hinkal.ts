import {ownHinkalEvmNote} from '../core/hinkal-evm-note';
import {Transaction,getBytes} from 'ethers';
import {unlockMultiVault} from './multi-vault';
import {wipeSolSecret} from './sol-secret';
import {HINKAL_PIN,validateHinkal,assertHinkalWallet,decodeHinkalData,hinkalApproval,verifyHinkalResponse} from '../core/hinkal-intent';
// Cryptography-only SDK modules; no SDK provider, HTTP client or relayer is imported.
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs');
const {UserKeys}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs');
const {decryptUtxo}=require('../../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/encryptDecryptUtxo.cjs');
const {Utxo}=require('../../node_modules/@hinkal/common/common/src/data-structures/utxo/Utxo.cjs');
export async function signHinkal(vault:any,password:string,input:unknown,fingerprint:string,now=Date.now()){
 const r=validateHinkal(JSON.parse(JSON.stringify(input)),now);assertHinkalWallet(r,vault.public);if(r.fingerprint!==fingerprint)throw Error('Hinkal fingerprint changed since review.');
 const start=performance.now(),clock=()=>now+Math.floor(performance.now()-start),keys=await unlockMultiVault(vault,password);
 try{
  if(['hinkal-deposit','hinkal-withdraw','hinkal-transfer'].includes(r.action)){await preProcessing();validateHinkal(r,clock());const {circomData:d,token}=decodeHinkalData(Transaction.from(r.unsignedTransaction).data,r);
  const identity=new UserKeys(await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage)),nk=identity.getShieldedPrivateKey(),pub=identity.getSpendingKeyPair().pubSpendingBJJPoint;
  const ownNote=(ciphertext:string)=>ownHinkalEvmNote(ciphertext,identity,token);
  let inputTotal=0n;const nullifiers:string[]=[];
  for(const ciphertext of r.inputNotes){const note=ownNote(ciphertext);inputTotal+=note.amount;nullifiers.push(BigInt(note.getNullifier()).toString());}
  const expected=d.inputNullifiers[0].filter((n:bigint)=>n!==0n).map(String);
  if(new Set(nullifiers).size!==nullifiers.length||JSON.stringify([...nullifiers].sort())!==JSON.stringify([...expected].sort()))throw Error('Hinkal private inputs differ from approved owned notes.');
  const remaining=inputTotal+(r.action==='hinkal-deposit'?BigInt(r.amount):-BigInt(r.amount));if(remaining<0n)throw Error('Insufficient independently decoded private balance.');
  if(remaining===0n){if(d.outCommitments[0][0]!==0n)throw Error('Unexpected Hinkal change commitment.');}
  else{const output=ownNote(d.encryptedOutputs[0][0]);if(output.amount!==remaining||BigInt(output.timeStamp)!==d.timeStamp||BigInt(output.getCommitment())!==d.outCommitments[0][0])throw Error('Hinkal private output ownership, amount or commitment mismatch.');}
  if(r.action==='hinkal-transfer'){const p=r.recipientInfo!.split(','),recipient=new Utxo({amount:BigInt(r.amount),erc20TokenAddress:token,timeStamp:d.timeStamp.toString(),H0:[BigInt(p[1]),BigInt(p[2])],stealthAddress:p[0],encryptionKey:p[5]});if(BigInt(recipient.getCommitment())!==d.outCommitments[0][1])throw Error('Private recipient commitment differs from its certified address and exact amount.');}
  // Keep the view/spend key inside this one-use process. It is never a response field.
  void nk;}validateHinkal(r,clock());const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));
  return verifyHinkalResponse({version:10,deviceId:r.deviceId,requestId:r.requestId,fingerprint:r.fingerprint,signedAt:new Date(clock()).toISOString(),rawSignedTransaction,transactionHash:Transaction.from(rawSignedTransaction).hash!,approvalSignature:await keys.evm.signMessage(hinkalApproval(r))},r,vault.public,clock());
 }finally{wipeSolSecret(keys.sol);}
}
