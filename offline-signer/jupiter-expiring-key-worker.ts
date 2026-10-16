import {readBoundedPipe} from './bounded-pipe';
import {MAX_EXPIRING_JUPITER_SIGN_FRAME} from './jupiter-expiring-boundary-codec';
import {signExpiringJupiterFrame} from './jupiter-expiring-key-core';
async function main(){if(process.argv.length!==2)throw Error();const frame=await readBoundedPipe(process.stdin,MAX_EXPIRING_JUPITER_SIGN_FRAME);try{process.stdout.write(await signExpiringJupiterFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Guarded Jupiter signing rejected.');process.exitCode=1;});
