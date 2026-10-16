import {createHash} from 'node:crypto';
import {PublicKey,type Connection,type AccountInfo} from '@solana/web3.js';
import {requireDeadlineGuard,type DeadlineGuardIdentity} from './solana-deadline-guard';
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export function verifyDeadlineGuardAccounts(program:AccountInfo<Buffer>|null,data:AccountInfo<Buffer>|null,identity:DeadlineGuardIdentity){
 const p=requireDeadlineGuard(identity);
 if(!program||!program.executable||!program.owner.equals(LOADER)||program.data.length!==36||program.data.readUInt32LE(0)!==2||new PublicKey(program.data.subarray(4)).toBase58()!==p.programData)throw Error('Deadline guard program identity changed.');
 // ProgramData has a fixed 45-byte metadata allocation. None (tag 0) means
 // upgrades are permanently disabled; padding is part of the recorded digest.
 if(!data||data.executable||!data.owner.equals(LOADER)||data.data.length<=45||data.data.length>1_000_000||data.data.readUInt32LE(0)!==3||data.data[12]!==0)throw Error('Deadline guard must be an immutable deployed program.');
 if(createHash('sha256').update(data.data.subarray(45)).digest('hex')!==p.sha256)throw Error('Deadline guard executable differs from the reviewed release.');
}
export async function verifyDeadlineGuardProgram(c:Connection,identity:DeadlineGuardIdentity,minContextSlot=0){
 const p=requireDeadlineGuard(identity);if(!Number.isSafeInteger(minContextSlot)||minContextSlot<0)throw Error('Invalid guard context slot.');
 const snapshot=await c.getMultipleAccountsInfoAndContext([new PublicKey(p.programId),new PublicKey(p.programData)],{commitment:'confirmed',minContextSlot});
 if(!Number.isSafeInteger(snapshot.context.slot)||snapshot.context.slot<minContextSlot||snapshot.value.length!==2)throw Error('Stale deadline guard snapshot.');
 verifyDeadlineGuardAccounts(snapshot.value[0],snapshot.value[1],p);return snapshot.context.slot;
}
