import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateSolSwap} from '../core/sol-swap-protocol';
import {isJupiterTradeShape,encodeJupiterRequestFrame} from './jupiter-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){
 if(process.argv.length!==3||!['jupiter-route','jupiter-request'].includes(process.argv[2]))throw Error('Unsupported purpose.');
 const bytes=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 if(process.argv[2]==='jupiter-route'){process.stdout.write(Buffer.concat([Buffer.from('DKJUPRT1'),Buffer.from([isJupiterTradeShape(value)?1:0])]));return;}
 // Expired requests are inspectable. The key process always enforces expiry.
 process.stdout.write(encodeJupiterRequestFrame(validateSolSwap(value,Date.now(),false)));
}
main().catch(()=>{process.stderr.write('Public Jupiter input rejected.');process.exitCode=1;});
