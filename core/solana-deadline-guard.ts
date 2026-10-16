import {PublicKey,TransactionInstruction} from '@solana/web3.js';
import {z} from 'zod';

const key=z.string().max(44).refine(v=>{try{return new PublicKey(v).toBase58()===v;}catch{return false;}});
export const deadlineGuardIdentitySchema=z.object({programId:key,programData:key,sha256:z.string().regex(/^[a-f0-9]{64}$/),immutable:z.literal(true)}).strict();
export type DeadlineGuardIdentity=z.infer<typeof deadlineGuardIdentitySchema>;
// Deliberately no example mainnet address or environment override. Installation
// requires reviewed source/binary correspondence and an immutable deployment.
export const DEADLINE_GUARD_RELEASE:Readonly<DeadlineGuardIdentity>|null=null;
export const DEADLINE_GUARD_DISCRIMINATOR=Buffer.from('DKEXPR01','ascii');
export function requireDeadlineGuard(identity:Readonly<DeadlineGuardIdentity>|null=DEADLINE_GUARD_RELEASE):DeadlineGuardIdentity{
 if(!identity)throw Error('Jupiter automatic expiry is unavailable until the reviewed immutable deadline guard is deployed and accepted.');
 const pin=deadlineGuardIdentitySchema.parse(identity);
 if(pin.programId===pin.programData||pin.programId===PublicKey.default.toBase58())throw Error('Invalid deadline guard identity.');
 return pin;
}
export function deadlineSeconds(expiresAt:string):bigint{
 const time=Date.parse(expiresAt);
 if(!Number.isSafeInteger(time)||time<=0||time%1000!==0)throw Error('Deadline must be an exact positive UTC second.');
 const seconds=BigInt(time/1000);if(seconds>0x7fffffffffffffffn)throw Error('Deadline exceeds the network clock range.');return seconds;
}
export function deadlineGuardInstruction(pin:DeadlineGuardIdentity,expiresAt:string):TransactionInstruction{
 const data=Buffer.alloc(16);DEADLINE_GUARD_DISCRIMINATOR.copy(data);data.writeBigUInt64LE(deadlineSeconds(expiresAt),8);
 return new TransactionInstruction({programId:new PublicKey(requireDeadlineGuard(pin).programId),keys:[],data});
}
// Mirrors the small Rust instruction contract for boundary tests, not evidence
// of Solana execution. The on-chain program obtains its own Clock sysvar.
export function inspectDeadlineGuardData(data:Uint8Array,networkUnixSeconds:bigint){
 const b=Buffer.from(data);if(b.length!==16||!b.subarray(0,8).equals(DEADLINE_GUARD_DISCRIMINATOR))throw Error('Malformed deadline guard instruction.');
 const deadline=b.readBigUInt64LE(8);if(deadline===0n||deadline>0x7fffffffffffffffn||networkUnixSeconds<0n)throw Error('Invalid network clock or deadline.');
 if(networkUnixSeconds>=deadline)throw Error('Swap deadline passed.');return deadline;
}
