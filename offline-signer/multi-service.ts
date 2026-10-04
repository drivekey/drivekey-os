// Guarded offline USB operations only. Separate filenames preserve every v2 vault/file.
import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, safeDirectory, writeJsonFile } from "../core/files";
import { multiReview, validateMultiRequest } from "../core/multi-protocol";
import { assertOfflineEnvironment } from "./environment";
import { createMultiVault, multiVaultSchema, signMultiVault, unlockMultiVault, upgradeMultiVault } from "./multi-vault";
export const MULTI_FILES = { vault: "vault-multi-encrypted.json", public: "wallet-multi-public.json", backup: "vault-multi-backup.json", request: "unsigned-multi-request.json", response: "signed-multi-response.json" };
const password=z.string().max(256);
const commands=z.discriminatedUnion("action",[
 z.object({scope:z.literal("multi"),action:z.literal("status")}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("review")}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("export-public")}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("create"),password,confirmation:password,consent:z.literal(true)}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("upgrade"),password,consent:z.literal(true)}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("check"),password}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("backup"),password}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("check-backup"),password}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("restore"),password,consent:z.literal(true)}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("sign"),password,fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true)}).strict(),
]);
async function absent(dir:string,name:string){try{await access(join(dir,name));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return;throw e;}throw Error("Existing file will not be overwritten.");}
export async function multiOfflineAction(input:unknown,directory:string){
 const c=commands.parse(input);await assertOfflineEnvironment();await safeDirectory(directory);
 if(c.action==="status"){let wallet=null;try{wallet=multiVaultSchema.parse(await readJsonFile(directory,MULTI_FILES.vault)).public;}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}return {wallet,message:wallet?"Multi-chain vault found. No network access.":"No multi-chain vault. Create or explicitly upgrade; existing v2 files are preserved."};}
 if(c.action==="create"||c.action==="upgrade"||c.action==="restore"){
  await absent(directory,MULTI_FILES.vault);await absent(directory,MULTI_FILES.public);
  if(c.action==="create"&&c.password!==c.confirmation)throw Error("Passphrases differ. Nothing was created.");
  if(c.action==="upgrade")await absent(directory,MULTI_FILES.backup);
  const vault=c.action==="create"?await createMultiVault(c.password):c.action==="upgrade"?await upgradeMultiVault(await readJsonFile(directory,"vault-encrypted.json"),c.password,c.consent):multiVaultSchema.parse(await readJsonFile(directory,MULTI_FILES.backup));
  const checked=await unlockMultiVault(vault,c.password);checked.sol.secretKey.fill(0);await assertOfflineEnvironment();
  await writeJsonFile(directory,MULTI_FILES.vault,vault);await writeJsonFile(directory,MULTI_FILES.public,vault.public);
  if(c.action==="upgrade"){await writeJsonFile(directory,MULTI_FILES.backup,vault);const backup=await unlockMultiVault(await readJsonFile(directory,MULTI_FILES.backup),c.password);if(backup.evm.address!==vault.public.evmAddress||backup.sol.publicKey.toBase58()!==vault.public.solanaAddress)throw Error("Backup belongs to a different vault.");backup.sol.secretKey.fill(0);}
  return {wallet:vault.public,message:"Multi-chain vault and public file saved. Original v2 files were not changed. Verify recovery and keep a separate encrypted backup after shutdown."};
 }
 const vault=multiVaultSchema.parse(await readJsonFile(directory,MULTI_FILES.vault));
 if(c.action==="export-public"){await writeJsonFile(directory,MULTI_FILES.public,vault.public,true);return {wallet:vault.public,message:"wallet-multi-public.json exported. No private key exported."};}
 if(c.action==="check"||c.action==="backup"||c.action==="check-backup"){
  const target=c.action==="check-backup"?multiVaultSchema.parse(await readJsonFile(directory,MULTI_FILES.backup)):vault;
  const keys=await unlockMultiVault(target,c.password);keys.sol.secretKey.fill(0);
  if(JSON.stringify(target.public)!==JSON.stringify(vault.public))throw Error("Backup belongs to a different vault.");
  await assertOfflineEnvironment();if(c.action==="backup")await writeJsonFile(directory,MULTI_FILES.backup,vault);
  return {wallet:vault.public,message:"Passphrase and both addresses verified. Same-USB backup is not protection against losing the device."};
 }
 const r=validateMultiRequest(await readJsonFile(directory,MULTI_FILES.request));
 if(r.deviceId!==vault.public.deviceId||(r.network==="solana"?r.from!==vault.public.solanaAddress:r.from.toLowerCase()!==vault.public.evmAddress.toLowerCase()))throw Error("Request belongs to a different vault.");
 if(c.action==="review")return {review:{...multiReview(r),deadlineUTC:r.expiresAt},message:"Read every field. Token metadata and RPC state are untrusted claims; verify independently."};
 if(c.fingerprint!==r.fingerprint)throw Error("Request changed since review.");
 const response=await signMultiVault(vault,c.password,r);await assertOfflineEnvironment();validateMultiRequest(r);
 if(validateMultiRequest(await readJsonFile(directory,MULTI_FILES.request)).fingerprint!==r.fingerprint)throw Error("Request changed during signing.");
 await writeJsonFile(directory,MULTI_FILES.response,response,true);
 return {hash:response.transactionHash,message:"signed-multi-response.json saved and independently verified. No funds sent."};
}
