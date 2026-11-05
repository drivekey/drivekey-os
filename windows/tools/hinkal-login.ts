// Isolated test-only identity worker. It cannot accept transactions or arbitrary messages.
import {unlockMultiVault} from '../engine/offline-signer/multi-vault';
import {wipeSolSecret,retainedSolSecret} from '../engine/offline-signer/sol-secret';
import {HINKAL_PIN} from '../engine/core/hinkal-intent';
import {getAddress,verifyMessage} from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {z} from 'zod';
const schema=z.object({action:z.literal('derive-test-hinkal-view'),testOnly:z.literal(true),chain:z.enum(['ethereum','solana']),expectedAddress:z.string(),password:z.string().min(16).max(256),vault:z.unknown()}).strict();
let bytes=0,parts:Buffer[]=[];process.stdin.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>16384)process.exit(2);parts.push(b);});process.stdin.on('end',async()=>{try{
 const raw=Buffer.concat(parts);parts.forEach(b=>b.fill(0));parts=[];let job;try{job=schema.parse(JSON.parse(raw.toString()));}finally{raw.fill(0);}
 const keys=await unlockMultiVault(job.vault,job.password);job.password='';
 try{let signature:string;if(job.chain==='ethereum'){if(keys.evm.address!==getAddress(job.expectedAddress))throw Error();signature=await keys.evm.signMessage(HINKAL_PIN.sdkLoginMessage);if(verifyMessage(HINKAL_PIN.sdkLoginMessage,signature)!==keys.evm.address)throw Error();}else{if(keys.sol.publicKey.toBase58()!==job.expectedAddress)throw Error();signature=bs58.encode(nacl.sign.detached(Buffer.from(HINKAL_PIN.sdkLoginMessage),retainedSolSecret(keys.sol)));}
  {
   const {preProcessing}=require('../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{UserKeys}=require('../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/keys.cjs');await preProcessing();const identity=new UserKeys(job.chain==='solana'?'0x'+Buffer.from(bs58.decode(signature)).toString('hex'):signature);
   process.stdout.write(JSON.stringify({ok:true,result:{chain:job.chain,address:job.expectedAddress,nullifyingKey:identity.getShieldedPrivateKey(),spendingPublicKey:identity.getSpendingKeyPair().pubSpendingBJJPoint.map(String),readOnly:true,testOnly:true}}),()=>process.exit(0));
  }
 }finally{wipeSolSecret(keys.sol);}
 }catch{process.stdout.write(JSON.stringify({ok:false,error:'Test-only Hinkal identity derivation refused.'}),()=>process.exit(1));}});
