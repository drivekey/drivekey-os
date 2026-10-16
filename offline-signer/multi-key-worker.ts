import {readBoundedPipe} from './bounded-pipe';
import {MAX_MULTI_SIGN_FRAME} from './multi-boundary-codec';
import {signMultiFrame} from './multi-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const frame=await readBoundedPipe(process.stdin,MAX_MULTI_SIGN_FRAME);try{process.stdout.write(await signMultiFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Transfer signing rejected.');process.exitCode=1;});
