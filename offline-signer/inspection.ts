// Read-only inspection. No unlocking, signing, network, or writes.
import { formatEther } from "ethers";
import { type TransferRequest } from "../core/protocol";
import { safeDirectory } from "../core/files";
import { multiReview, validateMultiRequest } from "../core/multi-protocol";
import { assertOfflineEnvironment } from "./environment";
import {readBoundedExchangeBytes} from './exchange-bytes';
import {parseMultiRequestBytes} from './multi-isolation';
import {parseEncryptedVaultBytes} from './savings-isolation';
import {robinhoodOfflineAction} from './robinhood-service';
import {MULTI_FILES} from './multi-files';

export function nativeReview(r: TransferRequest): Record<string, string> {
  return {network:"Robinhood Chain / chain ID 4663", asset:"Native ETH", from:r.from, recipient:r.to,
    amount:formatEther(r.value)+" ETH", baseUnits:r.value, gasLimit:r.gasLimit,
    maxFeePerGasWei:r.maxFeePerGas, maxPriorityFeePerGasWei:r.maxPriorityFeePerGas,
    maximumFee:formatEther(BigInt(r.gasLimit)*BigInt(r.maxFeePerGas))+" ETH",
    maximumDebit:formatEther(BigInt(r.value)+BigInt(r.gasLimit)*BigInt(r.maxFeePerGas))+" ETH",
    nonce:String(r.nonce), createdUTC:r.createdAt, deadlineUTC:r.expiresAt,
    requestId:r.requestId, fingerprint:r.fingerprint,
    warning:"Application expiry cannot revoke signed bytes. Verify the recipient independently."};
}

export async function inspectRequest(directory:string, multi:boolean) {
  if(!multi){
    const result=await robinhoodOfflineAction({action:'inspect'},directory);
    if(!('inspection' in result))throw Error('Invalid inspection response.');
    return result.inspection;
  }
  await assertOfflineEnvironment(); await safeDirectory(directory);
  try {
    const requestBytes=await readBoundedExchangeBytes(directory,MULTI_FILES.request);
    const r=validateMultiRequest(await parseMultiRequestBytes(requestBytes),Date.now(),false);
    const review=multiReview(r,false);
    let binding="No readable vault for this profile. Inspection only.";
    let matched=false;
    let vaultBytes:Buffer|undefined;
    try {
      vaultBytes=await readBoundedExchangeBytes(directory,MULTI_FILES.vault);
      const w=(await parseEncryptedVaultBytes(vaultBytes)).public;
      matched=r.deviceId===w.deviceId&&(r.network==='solana'?r.from===w.solanaAddress:r.from.toLowerCase()===w.evmAddress.toLowerCase());
      binding=matched?"Matches vault public metadata; passphrase not verified.":"Request belongs to a different vault. Signing blocked.";
    }catch{/* Missing or malformed vault is not an authenticated identity. */}
    if(!requestBytes.equals(await readBoundedExchangeBytes(directory,MULTI_FILES.request))||(vaultBytes&&!vaultBytes.equals(await readBoundedExchangeBytes(directory,MULTI_FILES.vault))))throw Error('Request or encrypted vault changed during inspection.');
    validateMultiRequest(r,Date.now(),false);
    await assertOfflineEnvironment();
    const expired=Date.now()>=Date.parse(r.expiresAt);
    return {state:expired?"expired":matched?"ready":"unbound",canSign:matched&&!expired,review:{...review,requestId:r.requestId,createdUTC:r.createdAt,deadlineUTC:r.expiresAt,binding},
      message:expired?"Request expired. Prepare a fresh request online. Never move the clock to match a request.":binding};
  }catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return {state:"missing",canSign:false,message:"No request found. Save the expected request file in the DriveKey folder before booting."};
    const message=e instanceof Error?e.message:"";
    const known=["Invalid request lifetime or clock.","Request fingerprint mismatch.","Wrong Solana cluster identity.","Unsupported EVM transaction.","Solana bytes contain", "Request fingerprint", "Wrong chain", "Invalid transfer", "Fee or nonce", "Solana quantity"];
    return {state:"invalid",canSign:false,message:known.some(p=>message.startsWith(p))?message:"Malformed, unsupported, oversized or unsafe request. Export a fresh supported request; do not edit it."};
  }
}
