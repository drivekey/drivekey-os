// Broker only: bounded encrypted bytes and typed public replies; no decryption.
import {z} from 'zod';
import {assertOfflineEnvironment} from './environment';
import {readBoundedExchangeBytes,writeBoundedExchangeBytes} from './exchange-bytes';
import {parseLifecycleVault,isolatedLifecycleOperation} from './lifecycle-isolation';
import {lifecycleVaultFrame,type LifecycleProfile,type LifecycleVault} from './lifecycle-boundary-codec';
import {lifecycleAbsent,writeLifecycleExclusive} from './lifecycle-exchange';
import {safeDirectory} from '../core/files';
const password=z.string().max(256),scope=z.literal('multi').optional();
const commands=z.discriminatedUnion('action',[
 z.object({scope,action:z.literal('status')}).strict(),z.object({scope,action:z.literal('export-public')}).strict(),
 z.object({scope,action:z.literal('create'),password,confirmation:password,consent:z.literal(true)}).strict(),
 z.object({scope,action:z.literal('upgrade'),password,consent:z.literal(true)}).strict(),
 z.object({scope,action:z.literal('restore'),password,consent:z.literal(true)}).strict(),
 ...(['check','backup','check-backup'] as const).map(action=>z.object({scope,action:z.literal(action),password}).strict()),
]);
const operations=new Set(['status','export-public','create','upgrade','restore','check','backup','check-backup']);
export function isLifecycleAction(input:unknown){return !!input&&typeof input==='object'&&'action'in input&&typeof input.action==='string'&&operations.has(input.action);}
const files=(p:LifecycleProfile)=>p==='v2'?{vault:'vault-encrypted.json',public:'wallet-public.json',backup:'vault-backup.json'}:{vault:'vault-multi-encrypted.json',public:'wallet-multi-public.json',backup:'vault-multi-backup.json'};
const serialized=(value:unknown)=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const identity=(v:LifecycleVault)=>JSON.stringify(v.public);
export async function lifecycleOfflineAction(input:unknown,directory:string){
 const c=commands.parse(input),profile:LifecycleProfile=c.scope==='multi'?'v3':'v2',f=files(profile);
 if(c.action==='upgrade'&&profile!=='v3')throw Error('Upgrade requires the multichain profile.');
 if(c.action==='create'&&c.password!==c.confirmation)throw Error('Passphrases differ. Nothing was created.');
 await assertOfflineEnvironment();await safeDirectory(directory);
 const snapshots=new Map<string,Buffer>();
 async function read(name:string,p:LifecycleProfile=profile){const bytes=await readBoundedExchangeBytes(directory,name);snapshots.set(name,bytes);return parseLifecycleVault(p,bytes);}
 async function unchanged(){for(const [name,bytes]of snapshots)if(!bytes.equals(await readBoundedExchangeBytes(directory,name)))throw Error('Lifecycle source changed during operation.');await assertOfflineEnvironment();}
 const reply=(vault:LifecycleVault|null,message:string)=>({wallet:vault?.public??null,message});
 if(c.action==='status'){
  let vault:LifecycleVault|null=null;try{vault=await read(f.vault);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await unchanged();return {...reply(vault,vault?'Encrypted vault found. Verify your passphrase and separate backup.':'No vault found. Create one or restore to an empty target.'),utc:new Date().toISOString(),network:'disabled'};
 }
 if(c.action==='create'||c.action==='restore'||c.action==='upgrade'){
  const targets=c.action==='upgrade'?[f.vault,f.backup,f.public]:[f.vault,f.public];await lifecycleAbsent(directory,targets);
  const source=c.action==='restore'?await read(f.backup):c.action==='upgrade'?await read('vault-encrypted.json','v2'):null;
  const op=c.action==='create'?(profile==='v2'?'create-v2':'create-v3'):c.action==='upgrade'?'upgrade':profile==='v2'?'check-v2':'check-v3';
  await unchanged();const vault=await isolatedLifecycleOperation(op,source,c.password);await unchanged();await lifecycleAbsent(directory,targets);
  const written:[string,Buffer][]=[[f.vault,serialized(vault)],...(c.action==='upgrade'?[[f.backup,serialized(vault)] as [string,Buffer]]:[]),[f.public,serialized(vault.public)]];
  for(const [name,bytes] of written)await writeLifecycleExclusive(directory,name,bytes);
  await unchanged();
  // Re-read and parse encrypted publication after the key worker has exited.
  const published=await parseLifecycleVault(profile,await readBoundedExchangeBytes(directory,f.vault));
  if(!lifecycleVaultFrame(profile,published).equals(lifecycleVaultFrame(profile,vault)))throw Error('Published lifecycle vault changed.');
  for(const [name,bytes] of written)if(!bytes.equals(await readBoundedExchangeBytes(directory,name)))throw Error('Lifecycle output changed before completion.');
  await unchanged();
  return reply(vault,'Encrypted vault and public identity saved. No approval or recovery trust was restored. Verify your passphrase and a separate backup before use.');
 }
 const vault=await read(f.vault);
 if(c.action==='export-public'){await unchanged();await writeBoundedExchangeBytes(directory,f.public,serialized(vault.public));await unchanged();return reply(vault,'Public identity exported from the encrypted vault. This is not proof of key control or authenticated chain state.');}
 const target=c.action==='check-backup'?await read(f.backup):vault;
 if(identity(target)!==identity(vault))throw Error('Backup belongs to another vault.');
 if(c.action==='backup')await lifecycleAbsent(directory,[f.backup]);
 await unchanged();await isolatedLifecycleOperation(profile==='v2'?'check-v2':'check-v3',target,c.password);await unchanged();
 if(c.action==='backup')await writeLifecycleExclusive(directory,f.backup,serialized(vault));
 await unchanged();return reply(vault,c.action==='backup'?'Encrypted backup saved and verified. A same-device copy does not protect against losing the device.':'Passphrase and public identity verified. No approval or transaction was created.');
}
