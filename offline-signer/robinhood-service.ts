// Broker for existing Robinhood v2 transfers. Never decrypts encrypted media.
import {z} from 'zod';
import {formatEther,getAddress} from 'ethers';
import {FILES,validateRequest,verifyResponse,type TransferRequest} from '../core/protocol';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseRobinhoodRequestBytes,parseRobinhoodVaultBytes,isolatedRobinhoodResponse} from './robinhood-isolation';
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('inspect')}).strict(),z.object({action:z.literal('review')}).strict(),
 z.object({action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string().regex(/^0x[0-9a-fA-F]{64}$/),consent:z.literal(true)}).strict(),
]);
function nativeReview(r:TransferRequest){return {network:'Robinhood Chain / chain ID 4663',asset:'Native ETH',from:r.from,recipient:r.to,amount:formatEther(r.value)+' ETH',baseUnits:r.value,gasLimit:r.gasLimit,maxFeePerGasWei:r.maxFeePerGas,maxPriorityFeePerGasWei:r.maxPriorityFeePerGas,maximumFee:formatEther(BigInt(r.gasLimit)*BigInt(r.maxFeePerGas))+' ETH',maximumDebit:formatEther(BigInt(r.value)+BigInt(r.gasLimit)*BigInt(r.maxFeePerGas))+' ETH',nonce:r.nonce,createdUTC:r.createdAt,deadlineUTC:r.expiresAt,requestId:r.requestId,fingerprint:r.fingerprint,warning:'Application expiry cannot revoke signed bytes. Verify the recipient independently.'};}
export async function robinhoodOfflineAction(input:unknown,directory:string){
 const c=command.parse(input);await assertOfflineEnvironment();
 try{
  const requestBytes=await readBoundedExchangeBytes(directory,FILES.request),r=validateRequest(await parseRobinhoodRequestBytes(requestBytes),Date.now(),c.action!=='inspect');
  let vaultBytes:Buffer|undefined,vault:Awaited<ReturnType<typeof parseRobinhoodVaultBytes>>|undefined;
  try{vaultBytes=await readBoundedExchangeBytes(directory,FILES.vault);vault=await parseRobinhoodVaultBytes(vaultBytes);}catch(error){if(c.action!=='inspect')throw error;}
  const matched=!!vault&&vault.public.deviceId===r.deviceId&&getAddress(vault.public.address)===getAddress(r.from);
  const unchanged=async()=>{
   if(!requestBytes.equals(await readBoundedExchangeBytes(directory,FILES.request))||(vaultBytes&&!vaultBytes.equals(await readBoundedExchangeBytes(directory,FILES.vault))))throw Error('Request or encrypted vault changed during Robinhood approval.');
   validateRequest(r,Date.now(),c.action!=='inspect');
  };
  await unchanged();
  if(c.action==='inspect'){
   const expired=Date.now()>=Date.parse(r.expiresAt),binding=!vault?'No readable vault for this profile. Inspection only.':matched?'Matches vault public metadata; passphrase not verified.':'Request belongs to a different vault. Signing blocked.';
   return {inspection:{state:expired?'expired':matched?'ready':'unbound',canSign:matched&&!expired,review:{...nativeReview(r),binding},message:expired?'Request expired. Prepare a fresh request online. Never move the clock to match a request.':binding}};
  }
  if(!matched||!vault)throw Error('Request belongs to a different vault.');
  if(c.action==='review')return {review:{...nativeReview(r),network:'Robinhood Chain / 4663 / native ETH'},message:'Compare the full recipient against an independently known address. Approval signs this exact transfer.'};
  if(c.fingerprint!==r.fingerprint)throw Error('Request changed since review. Review again; nothing was signed.');
  await assertOfflineEnvironment();const signed=await isolatedRobinhoodResponse(r,vault,c.fingerprint,c.password);
  // The launcher resolves only once the key process and descendants have exited.
  await assertOfflineEnvironment();await unchanged();
  const response=verifyResponse(signed,r,vault.public);
  await writeBoundedExchangeBytes(directory,FILES.response,Buffer.from(JSON.stringify(response,null,2)+'\n'));
  return {hash:response.transactionHash,message:'signed-response.json saved and verified. Nothing was broadcast. Shut down fully before returning to Windows.'};
 }catch(error){
  if(c.action!=='inspect')throw error;
  return {inspection:{state:(error as NodeJS.ErrnoException)?.code==='ENOENT'?'missing':'invalid',canSign:false,message:(error as NodeJS.ErrnoException)?.code==='ENOENT'?'No request found. Save the expected request file in the DriveKey folder before booting.':'Malformed, unsupported, oversized or unsafe request. Export a fresh supported request; do not edit it.'}};
 }
}
