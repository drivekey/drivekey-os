import {createHash} from 'node:crypto';
import {HINKAL_ABI} from './hinkal-intent';
const key=require('../../vendor/hinkal/evm-2x2x1-verification-key.json');
// Extracted from the SHA-pinned official 2x2x1 proving key. A proof made with
// that key has also executed against the pinned pool on a mainnet fork.
if(createHash('sha256').update(JSON.stringify(key)).digest('hex')!=='5d5e513273ed55cda2351a68ba9315ffc7f9e49536d0c2292a2c6cbd9210a8d0')throw Error('Pinned local swap verification key changed.');
import {verifyGroth16Calldata,HINKAL_SCALAR} from './hinkal-groth16';
export async function verifyHinkalEvmGroth16(data:string,signedMessageHash:string){try{const x=HINKAL_ABI.decodeFunctionData('transact',data),dim=x[3],d=x[4];if(dim.tokenNumber!==2n||dim.nullifierAmount!==2n||dim.outputAmount!==1n||d.publicSignalCount!==20n)throw Error();const pub=[d.stealthAddressStructure.H1x,d.stealthAddressStructure.H1y,d.stealthAddressStructure.stealthAddress,d.emporiumMessage,d.rootHashHinkal,signedMessageHash,...d.erc20TokenAddresses.map(BigInt),...d.amountChanges.map((n:bigint)=>n<0n?HINKAL_SCALAR+n:n),...d.inputNullifiers.flat(),d.timeStamp,...d.outCommitments.flat(),d.calldataHash,d.stealthAddressStructure.H0x,d.stealthAddressStructure.H0y];await verifyGroth16Calldata(key,pub,{a:Array.from(x[0]),b:x[1].map((row:any)=>Array.from(row)),c:Array.from(x[2])});return true;}catch{throw Error('Local private swap Groth16 proof or public signals are invalid.');}}
