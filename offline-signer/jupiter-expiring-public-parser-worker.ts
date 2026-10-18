import {parseStrictPublicJson} from '../core/strict-public-json';
import {isExpiringJupiterShape,validateExpiringJupiter} from '../core/jupiter-expiring-protocol';
import {encodeExpiringJupiterRequestFrame} from './jupiter-expiring-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){
 if(process.argv.length!==3||!['jupiter-expiring-route','jupiter-expiring-request'].includes(process.argv[2]))throw Error();
 const bytes=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 if(process.argv[2]==='jupiter-expiring-route'){process.stdout.write(Buffer.concat([Buffer.from('DKJXPRT1'),Buffer.from([isExpiringJupiterShape(value)?1:0])]));return;}
 process.stdout.write(encodeExpiringJupiterRequestFrame(validateExpiringJupiter(value,Date.now(),false)));
}
main().catch(()=>{process.stderr.write('Guarded Jupiter public input rejected.');process.exitCode=1;});
