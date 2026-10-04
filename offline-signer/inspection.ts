// Read-only inspection. No unlocking, signing, network, or writes.
import { formatEther } from "ethers";
import { FILES, validateRequest, type TransferRequest } from "../core/protocol";
import { readJsonFile, safeDirectory } from "../core/files";
import { multiReview, validateMultiRequest } from "../core/multi-protocol";
import { validateVault } from "./vault";
import { multiVaultSchema } from "./multi-vault";
import { assertOfflineEnvironment } from "./environment";

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
  await assertOfflineEnvironment(); await safeDirectory(directory);
  try {
    const raw=await readJsonFile(directory,multi?"unsigned-multi-request.json":FILES.request);
    const r=multi?validateMultiRequest(raw,Date.now(),false):validateRequest(raw,Date.now(),false);
    const review=multi?multiReview(r,false):nativeReview(r as TransferRequest);
    let binding="No readable vault for this profile. Inspection only.";
    let matched=false;
    try {
      if(multi){const w=multiVaultSchema.parse(await readJsonFile(directory,"vault-multi-encrypted.json")).public;
        const mr=validateMultiRequest(r,Date.now(),false); matched=mr.deviceId===w.deviceId&&(mr.network==="solana"?mr.from===w.solanaAddress:mr.from.toLowerCase()===w.evmAddress.toLowerCase());}
      else {const w=validateVault(await readJsonFile(directory,FILES.vault)).public;matched=r.deviceId===w.deviceId&&r.from.toLowerCase()===w.address.toLowerCase();}
      binding=matched?"Matches vault public metadata; passphrase not verified.":"Request belongs to a different vault. Signing blocked.";
    }catch{/* Missing or malformed vault is not an authenticated identity. */}
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
