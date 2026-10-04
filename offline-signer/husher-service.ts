import {Transaction} from 'ethers';
import {assertOfflineEnvironment} from './environment';
import {readJsonFile,writeJsonFile} from '../core/files';
import {multiVaultSchema,unlockMultiVault} from './multi-vault';
import {validateHusherDeposit,husherDepositReview,husherDepositApproval,verifyHusherDepositResponse} from '../core/husher-deposit-protocol';

export async function husherOfflineAction(c:{action:'inspect'|'sign';password?:string;fingerprint?:string;consent?:boolean},directory:string){
 await assertOfflineEnvironment();
 const r=validateHusherDeposit(await readJsonFile(directory,'unsigned-trade-request.json'),Date.now(),c.action==='sign');
 const v=multiVaultSchema.parse(await readJsonFile(directory,'vault-multi-encrypted.json'));
 if(v.public.deviceId!==r.payment.deviceId||v.public.evmAddress.toLowerCase()!==r.payment.from.toLowerCase())throw Error('Request belongs to a different vault.');
 if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(r.payment.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(r.payment.expiresAt),review:husherDepositReview(r,false),message:'Husher standard exchange deposit. Read the provider commitments and custodial warning before approving.'}};
 if(c.consent!==true||c.fingerprint!==r.fingerprint)throw Error('Request changed since review.');
 const keys=await unlockMultiVault(v,c.password!);
 try{
  const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.payment.unsignedTransaction));
  const response=verifyHusherDepositResponse({version:8,requestId:r.payment.requestId,deviceId:r.payment.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,
   approvalSignature:await keys.evm.signMessage(husherDepositApproval(r)),transactionHash:Transaction.from(rawSignedTransaction).hash},r,v.public);
  await assertOfflineEnvironment();validateHusherDeposit(r);
  if(validateHusherDeposit(await readJsonFile(directory,'unsigned-trade-request.json')).fingerprint!==r.fingerprint)throw Error('Request changed during signing.');
  await writeJsonFile(directory,'signed-trade-response.json',response,true);
  return {hash:response.transactionHash,message:'Provider-bound signed-trade-response.json saved and verified. No funds sent; payout not verified.'};
 }finally{keys.sol.secretKey.fill(0);}
}
