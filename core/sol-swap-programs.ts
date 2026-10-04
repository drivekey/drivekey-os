// Server-only: refuse program upgrades until the new bytecode has passed acceptance.
import {createHash} from 'node:crypto';
import {Connection,PublicKey,type AccountInfo} from '@solana/web3.js';
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const SOL_SWAP_PROGRAM_PINS=Object.freeze([
 Object.freeze({address:'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',programData:'4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT',sha256:'7bfe71031cc06010971fbf7bc3bc5c6499212d26170f110f32d4ee1c79909859'}),
 Object.freeze({address:'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',programData:'HzD2cCXXT3UQNjMMY6kDv9w6gZ9qquSdfoGXrLL3LXx',sha256:'c8fa1d9f02c63123c118b27a96a4e73ec4c015f16b093872afceb7657bfac4b0'}),
]);
// Exported for isolated parser tests; online callers always use the fixed pins above.
export function verifyProgramBytes(program:AccountInfo<Buffer>|null,data:AccountInfo<Buffer>|null,pin:{programData:string;sha256:string}){
 if(!program||!program.executable||!program.owner.equals(LOADER)||program.data.length!==36||program.data.readUInt32LE(0)!==2||new PublicKey(program.data.subarray(4,36)).toBase58()!==pin.programData)throw Error('Swap program identity or loader changed.');
 if(!data||data.executable||!data.owner.equals(LOADER)||data.data.length<=45||data.data.length>10000000||data.data.readUInt32LE(0)!==3||data.data[12]>1)throw Error('Unsupported swap program data.');
 if(createHash('sha256').update(data.data.subarray(45)).digest('hex')!==pin.sha256)throw Error('Swap program bytecode changed. Execution requires renewed acceptance.');
}
export async function verifySolSwapPrograms(c:Connection,minContextSlot=0){
 if(!Number.isSafeInteger(minContextSlot)||minContextSlot<0)throw Error('Invalid program context.');
 const keys=SOL_SWAP_PROGRAM_PINS.flatMap(p=>[new PublicKey(p.address),new PublicKey(p.programData)]);
 const snapshot=await c.getMultipleAccountsInfoAndContext(keys,{commitment:'confirmed',minContextSlot});
 if(!Number.isSafeInteger(snapshot.context.slot)||snapshot.context.slot<minContextSlot||snapshot.value.length!==keys.length)throw Error('Stale or incomplete program snapshot.');
 SOL_SWAP_PROGRAM_PINS.forEach((pin,i)=>verifyProgramBytes(snapshot.value[i*2],snapshot.value[i*2+1],pin));
 return {slot:snapshot.context.slot,programs:SOL_SWAP_PROGRAM_PINS};
}
