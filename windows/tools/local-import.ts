// Interactive, local-only provisioning. Never call with a private key/password in args or env.
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {createHiddenTerminal} from './hidden-input';
import {getAddress} from 'ethers';
import {createHash} from 'node:crypto';
import {importLocalEthereumKey,importLocalEthereumKeystore,validateLocalEthereumKey,checkedEthereumKeystore,LocalImportError,LOCAL_IMPORT_MESSAGES} from '../engine/offline-signer/keystore-import';
import {verifyVault,createVault} from '../signer';

async function boundedKeystore(file:string){const h=await open(file,'r');try{const s=await h.stat();if(!s.isFile()||s.size>65536)throw Error('Keystore file exceeds limit.');const b=Buffer.alloc(65537),{bytesRead}=await h.read(b,0,b.length,0);if(bytesRead>65536)throw Error('Keystore file exceeds limit.');return JSON.parse(b.subarray(0,bytesRead).toString('utf8'));}finally{await h.close();}}
export async function runLocalImport(args:string[],terminalFactory=createHiddenTerminal){
 let stage='arguments';
 if(args.length===1&&args[0]==='--help'){console.log('Local import (no funds moved):\n  node --no-addons dist/local-import.cjs ethereum-key PUBLIC_ADDRESS NEW_PRIVATE_DIRECTORY\n  node --no-addons dist/local-import.cjs ethereum-keystore PUBLIC_ADDRESS NEW_PRIVATE_DIRECTORY ENCRYPTED_KEYSTORE_PATH\nEnter secrets only in the hidden local prompts. Never put them in arguments, environment variables, chat or screenshots. A new independent, unfunded Solana credential is generated; the Ethereum private key is never reused as a Solana seed.');return;}
 const [mode,address,directory,file]=args;
 if(!['ethereum-key','ethereum-keystore'].includes(mode)||!address||!directory||args.length!==(mode==='ethereum-key'?3:4))throw Error('Use --help for local provisioning syntax.');
 // Abort before prompting or reading files in a noninteractive/redirected session.
 if(terminalFactory===createHiddenTerminal&&(!process.stdin.isTTY||!process.stdout.isTTY))throw Error('Use an interactive local terminal.');
 getAddress(address);const target=path.resolve(directory);
 try{await (await import('node:fs/promises')).stat(target);throw Error('output-exists');}catch(error:any){if(error.code!=='ENOENT')throw Error('output-exists');}
 const source=mode==='ethereum-keystore'?await boundedKeystore(path.resolve(file)):null;
 if(source)checkedEthereumKeystore(source);const terminal=terminalFactory();
 let original:string|undefined,password:string|undefined,confirmation:string|undefined;
 try{
  stage='credential';original=await terminal.read(mode==='ethereum-key'?'Disposable Ethereum private key (hidden, local only): ':'Existing keystore password (hidden): ');
  if(mode==='ethereum-key'){original=original.trim();validateLocalEthereumKey(original,address);}
  stage='passphrase';for(let attempt=0;attempt<3;attempt++){
   password=await terminal.read('NEW DriveKey vault passphrase (16–256 characters, hidden): ');
   if(password.length<16||password.length>256){process.stderr.write('Passphrase must contain 16–256 characters. Try again locally.\n');password=undefined;continue;}
   confirmation=await terminal.read('Confirm NEW passphrase (hidden): ');if(password===confirmation){confirmation=undefined;break;}
   process.stderr.write('Passphrases did not match. Try again locally.\n');password=undefined;confirmation=undefined;
  }if(password===undefined)throw Error('passphrase-retries');
  stage='encryption';
  const vault=mode==='ethereum-key'?await importLocalEthereumKey(original,password,address):await importLocalEthereumKeystore(source,original,password,address);original=undefined;
  stage='verification';await verifyVault(vault,password);const receiver=await createVault(password);await verifyVault(receiver,password);password=undefined;
  // Exclusive directory/files: preserve the user's source and never overwrite a vault.
  stage='output';await mkdir(target,{recursive:false});
  const bytes=JSON.stringify(vault,null,2)+'\n';await writeFile(path.join(target,'vault-encrypted.json'),bytes,{flag:'wx',mode:0o600});
  await writeFile(path.join(target,'receiver-vault-encrypted.json'),JSON.stringify(receiver,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(path.join(target,'wallet-public.json'),JSON.stringify(vault.public,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(path.join(target,'receiver-wallet-public.json'),JSON.stringify(receiver.public,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(path.join(target,'PROVISIONING-RECEIPT.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),mode,public:vault.public,receiverPublic:receiver.public,vaultSHA256:createHash('sha256').update(bytes).digest('hex'),fundsMoved:false,signingAuthorization:false,solanaCredential:'New independent unfunded credential; not derived from Ethereum private key'},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Imported vault, independent receiver vault and public identities saved locally. No funds moved. Open each encrypted vault in DriveKey, save a separate encrypted backup and verify it. Share only the public provisioning receipt.');
 }catch(error){throw {localStage:stage,reason:error instanceof LocalImportError?error.code:undefined,kind:error instanceof Error&&['input-cancelled','input-too-long','input-control','passphrase-retries'].includes(error.message)?error.message:undefined};}finally{original=undefined;password=undefined;confirmation=undefined;terminal.close();}
}
export function safeImportFailure(error:unknown):string{
 const e=error as any;let reason='Check the local input and try again. No private values were logged.';
 if(e?.reason&&Object.hasOwn(LOCAL_IMPORT_MESSAGES,e.reason))reason=LOCAL_IMPORT_MESSAGES[e.reason as keyof typeof LOCAL_IMPORT_MESSAGES];
 else if(e?.kind==='input-cancelled')reason='Local input was cancelled.';
 else if(e?.kind==='input-control')reason='The local input contains unsupported control characters. Paste a single line or type it again locally.';
 else if(e?.kind==='input-too-long')reason='The input exceeds the local length limit.';
 else if(e?.kind==='passphrase-retries')reason='Passphrase entry did not complete after three attempts.';
 else if(e?.localStage==='output')reason='Could not save the output. Check free space and local folder permissions; preserve any encrypted files already created.';
 else if(e instanceof Error&&e.message==='output-exists')reason='The output directory already exists. Use a new empty destination; existing files were preserved.';
 else if(e?.localStage==='verification')reason='Encrypted-vault verification failed. Preserve the original credential and retry locally.';
 else if(e?.localStage==='encryption')reason='Vault encryption failed. Check local resources and the original keystore/password.';
 return 'Local import stopped: '+reason+' No funds were moved. Keep the key and passphrases out of chat.';
}
if(require.main===module)runLocalImport(process.argv.slice(2)).catch(error=>{console.error(safeImportFailure(error));process.exitCode=1;});
