// OFFLINE ONLY: shares the encrypted multichain vault, never its secret with the web app.
import { z } from 'zod';
import { Transaction } from 'ethers';
import { VersionedMessage,VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { assertOfflineEnvironment } from './environment';
import { readJsonFile, safeDirectory, writeJsonFile } from '../core/files';
import { multiVaultSchema, unlockMultiVault } from './multi-vault';
import { tradeApproval, tradeReview, validateTrade, verifyTradeResponse } from '../core/trade-protocol';
import { solSwapApproval,solSwapReview,validateSolSwap,verifySolSwapResponse } from '../core/sol-swap-protocol';
import {offlineNonceSignAction} from './nonce-service';
import {husherOfflineAction} from './husher-service';
export const TRADE_FILES={request:'unsigned-trade-request.json',response:'signed-trade-response.json'};
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('trade'),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('trade'),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string(),consent:z.literal(true)}).strict(),
]);
export async function tradeOfflineAction(input:unknown,directory:string) {
 const c=command.parse(input);await assertOfflineEnvironment();await safeDirectory(directory);
 const raw=await readJsonFile(directory,TRADE_FILES.request);
 if(raw&&typeof raw==='object'&&'version' in raw&&raw.version===8)return husherOfflineAction(c,directory);
 if(raw&&typeof raw==='object'&&'version' in raw&&raw.version===5)return offlineNonceSignAction(c,directory);
 const sol=!!raw&&typeof raw==='object'&&'network' in raw&&raw.network==='solana';
 const r=sol?validateSolSwap(raw,Date.now(),c.action==='sign'):validateTrade(raw,Date.now(),c.action==='sign');
 const v=multiVaultSchema.parse(await readJsonFile(directory,'vault-multi-encrypted.json'));
 if(v.public.deviceId!==r.deviceId||(sol?v.public.solanaAddress!==r.from:v.public.evmAddress.toLowerCase()!==r.from.toLowerCase()))throw Error('Request belongs to a different vault.');
 if(c.action==='inspect')return {inspection:{state:Date.now()>=Date.parse(r.expiresAt)?'expired':'ready',canSign:Date.now()<Date.parse(r.expiresAt),review:sol?solSwapReview(r,false):tradeReview(r,false),message:(sol?'Solana':'Ethereum')+' release-candidate transaction. Review every field before signing.'}};
 if(c.fingerprint!==r.fingerprint)throw Error('Request changed since review.');
 const keys=await unlockMultiVault(v,c.password);
 try {
  if(r.network==='solana'){
   const tx=new VersionedTransaction(VersionedMessage.deserialize(Buffer.from(r.unsignedMessage,'base64')));tx.sign([keys.sol]);
   const response=verifySolSwapResponse({version:4,network:'solana',requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction:Buffer.from(tx.serialize()).toString('base64'),approvalSignature:bs58.encode(nacl.sign.detached(solSwapApproval(r),keys.sol.secretKey)),transactionHash:bs58.encode(tx.signatures[0])},r,v.public);
   await assertOfflineEnvironment();validateSolSwap(r);
   if(validateSolSwap(await readJsonFile(directory,TRADE_FILES.request)).fingerprint!==r.fingerprint)throw Error('Request changed during signing.');
   await writeJsonFile(directory,TRADE_FILES.response,response,true);
   return {hash:response.transactionHash,message:'signed-trade-response.json saved and verified. No funds sent.'};
  }
  const rawSignedTransaction=await keys.evm.signTransaction(Transaction.from(r.unsignedTransaction));
  const response=verifyTradeResponse({version:r.version,requestId:r.requestId,deviceId:r.deviceId,fingerprint:r.fingerprint,signedAt:new Date().toISOString(),rawSignedTransaction,approvalSignature:await keys.evm.signMessage(tradeApproval(r)),transactionHash:Transaction.from(rawSignedTransaction).hash},r,v.public);
  await assertOfflineEnvironment();validateTrade(r);
  if(validateTrade(await readJsonFile(directory,TRADE_FILES.request)).fingerprint!==r.fingerprint)throw Error('Request changed during signing.');
  await writeJsonFile(directory,TRADE_FILES.response,response,true);
  return {hash:response.transactionHash,message:'signed-trade-response.json saved and verified. No funds sent.'};
 }finally{keys.sol.secretKey.fill(0);}
}
