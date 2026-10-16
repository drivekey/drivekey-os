// Internal typed transport only; published v2/v3 encrypted vault formats unchanged.
import {createHash} from 'node:crypto';
import {encodeRobinhoodVaultFrame,decodeRobinhoodVaultFrame} from './robinhood-boundary-codec';
import {encodeVaultFrame,decodeVaultFrame} from './savings-boundary-codec';
export type LifecycleProfile='v2'|'v3';
export type LifecycleOperation='create-v2'|'create-v3'|'check-v2'|'check-v3'|'upgrade';
export type LifecycleVault=ReturnType<typeof decodeRobinhoodVaultFrame>|ReturnType<typeof decodeVaultFrame>;
export const LIFECYCLE_MAX_VAULT=4608,LIFECYCLE_MAX_COMMAND=6144,LIFECYCLE_MAX_RESPONSE=4672;
const operations:LifecycleOperation[]=['create-v2','create-v3','check-v2','check-v3','upgrade'];
class Writer{
 chunks:Buffer[]=[];
 bytes(b:Uint8Array){this.chunks.push(Buffer.from(b));}
 field(b:Uint8Array,max:number){if(b.length>max)throw Error('Lifecycle field exceeds limit.');const n=Buffer.alloc(2);n.writeUInt16BE(b.length);this.chunks.push(n,Buffer.from(b));}
 finish(max:number){try{const b=Buffer.concat(this.chunks);if(b.length>max){b.fill(0);throw Error('Lifecycle frame exceeds limit.');}return b;}finally{for(const b of this.chunks)b.fill(0);}}
}
class Reader{
 at=0;constructor(private b:Buffer,max:number){if(!Buffer.isBuffer(b)||b.length>max)throw Error('Lifecycle frame exceeds limit.');}
 bytes(n:number){if(!Number.isSafeInteger(n)||n<0||this.at+n>this.b.length)throw Error('Truncated lifecycle frame.');const b=this.b.subarray(this.at,this.at+n);this.at+=n;return b;}
 field(max:number){const n=this.bytes(2).readUInt16BE();if(n>max)throw Error('Lifecycle field exceeds limit.');return this.bytes(n);}
 magic(s:string){if(!this.bytes(8).equals(Buffer.from(s)))throw Error('Wrong lifecycle frame purpose.');}
 operation(){const op=operations[this.bytes(1)[0]];if(!op)throw Error('Unknown lifecycle operation.');return op;}
 end(){if(this.at!==this.b.length)throw Error('Trailing lifecycle frame.');}
}
export function lifecycleVaultFrame(profile:LifecycleProfile,input:unknown){if(profile==='v2')return encodeRobinhoodVaultFrame(input);if(profile==='v3')return encodeVaultFrame(input);throw Error('Unsupported vault profile.');}
export function decodeLifecycleVault(profile:LifecycleProfile,frame:Buffer):LifecycleVault{if(profile==='v2')return decodeRobinhoodVaultFrame(frame);if(profile==='v3')return decodeVaultFrame(frame);throw Error('Unsupported vault profile.');}
function sourceProfile(op:LifecycleOperation):LifecycleProfile{return op==='check-v3'?'v3':'v2';}
export function resultProfile(op:LifecycleOperation):LifecycleProfile{return op==='create-v2'||op==='check-v2'?'v2':'v3';}
export function lifecycleBinding(op:LifecycleOperation,vault:LifecycleVault|null){
 if(!operations.includes(op))throw Error('Unsupported lifecycle operation.');
 const bytes=op.startsWith('create-')?Buffer.alloc(0):lifecycleVaultFrame(sourceProfile(op),vault);
 if(op.startsWith('create-')&&vault!==null)throw Error('Create cannot accept an existing key.');
 return createHash('sha256').update('DriveKey lifecycle input v1\0').update(op).update(bytes).digest();
}
export function encodeLifecycleCommand(op:LifecycleOperation,vault:LifecycleVault|null,password:string){
 if(typeof password!=='string'||password.length>256)throw Error('Invalid lifecycle password bounds.');
 const secret=Buffer.from(password,'utf8'),w=new Writer();
 try{
  if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(secret)!==password)throw Error('Lossy lifecycle password.');
  w.bytes(Buffer.from('DKLCREQ1'));w.bytes(Buffer.from([operations.indexOf(op)]));w.bytes(lifecycleBinding(op,vault));
  w.field(op.startsWith('create-')?Buffer.alloc(0):lifecycleVaultFrame(sourceProfile(op),vault),LIFECYCLE_MAX_VAULT);w.field(secret,1024);return w.finish(LIFECYCLE_MAX_COMMAND);
 }finally{secret.fill(0);}
}
export function decodeLifecycleCommand(frame:Buffer){
 const r=new Reader(frame,LIFECYCLE_MAX_COMMAND);r.magic('DKLCREQ1');const operation=r.operation(),binding=Buffer.from(r.bytes(32)),raw=r.field(LIFECYCLE_MAX_VAULT);
 const vault=operation.startsWith('create-')?(raw.length?(()=>{throw Error('Create cannot accept vault bytes.');})():null):decodeLifecycleVault(sourceProfile(operation),raw);
 const password=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(r.field(1024));r.end();
 if(password.length>256||!binding.equals(lifecycleBinding(operation,vault)))throw Error('Lifecycle binding differs.');return {operation,vault,password,binding};
}
export function encodeLifecycleResult(op:LifecycleOperation,binding:Buffer,vault:LifecycleVault){
 if(!operations.includes(op)||binding.length!==32)throw Error('Invalid lifecycle result.');
 const w=new Writer();w.bytes(Buffer.from('DKLCRES1'));w.bytes(Buffer.from([operations.indexOf(op)]));w.bytes(binding);w.field(lifecycleVaultFrame(resultProfile(op),vault),LIFECYCLE_MAX_VAULT);return w.finish(LIFECYCLE_MAX_RESPONSE);
}
export function decodeLifecycleResult(frame:Buffer,op:LifecycleOperation,input:LifecycleVault|null){
 const r=new Reader(frame,LIFECYCLE_MAX_RESPONSE);r.magic('DKLCRES1');const operation=r.operation(),binding=r.bytes(32),vault=decodeLifecycleVault(resultProfile(operation),r.field(LIFECYCLE_MAX_VAULT));r.end();
 if(operation!==op||!binding.equals(lifecycleBinding(op,input)))throw Error('Lifecycle response belongs to another operation/input.');
 if(op.startsWith('check-')&&!lifecycleVaultFrame(resultProfile(op),vault).equals(lifecycleVaultFrame(resultProfile(op),input)))throw Error('Checked encrypted vault changed.');
 if(op==='upgrade'&&(vault.public.deviceId!==input?.public.deviceId||vault.public.createdAt!==input.public.createdAt||vault.version!==3||input.version!==2||vault.public.evmAddress.toLowerCase()!==input.public.address.toLowerCase()))throw Error('Upgrade identity changed.');
 return vault;
}
