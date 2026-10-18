// Offline GUI dispatch. Lifecycle media parsing and key handling are separate workers.
import {robinhoodOfflineAction} from './robinhood-service';
import {isLifecycleAction,lifecycleOfflineAction} from './lifecycle-service';
export async function guiAction(input:unknown,directory:string){
 if(isLifecycleAction(input)){
  if(input&&typeof input==='object'&&'scope' in input)throw Error('Unsupported native vault scope.');
  return lifecycleOfflineAction(input,directory);
 }
 return robinhoodOfflineAction(input,directory);
}
export function safeGuiError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "Expected file missing. Check the DriveKey folder and exact filenames.";
  if (code === "EROFS" || code === "EACCES") return "Storage is read-only or permission was denied. No success was recorded.";
  if (code === "ENOSPC") return "USB storage is full. Preserve your vault and free space in Windows after shutdown.";
  if (code === "EEXIST") return "Existing file will not be overwritten. Verify your existing backup instead.";
  const message = error instanceof Error ? error.message : "";
  const allowed = ["Passphrases differ.", "Incorrect passphrase or damaged encrypted vault.", "Use a unique passphrase of", "Existing file will not", "Request expired.", "Invalid request lifetime or clock.", "Request changed", "Request belongs", "Backup belongs", "Boot the DriveKey", "Real vault setup", "Network addresses", "An active network", "Swap must"];
  return allowed.some(p => message.startsWith(p)) ? message : "Operation stopped. Preserve any new or partial files and inspect recovery status before continuing. Existing vaults were not replaced; a multi-file operation may be incomplete. Existing targets will not be overwritten on retry.";
}
