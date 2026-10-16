import {readBoundedPipe} from './bounded-pipe';
import {MAX_JUPITER_SIGN_FRAME} from './jupiter-boundary-codec';
import {signJupiterFrame} from './jupiter-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const frame=await readBoundedPipe(process.stdin,MAX_JUPITER_SIGN_FRAME);try{process.stdout.write(await signJupiterFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Jupiter signing rejected.');process.exitCode=1;});
