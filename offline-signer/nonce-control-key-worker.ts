import {readBoundedPipe} from './bounded-pipe';
import {MAX_NONCE_CONTROL_SIGN_FRAME} from './nonce-control-boundary-codec';
import {signNonceControlFrame} from './nonce-control-key-core';
async function main(){if(process.argv.length!==2)throw Error();const frame=await readBoundedPipe(process.stdin,MAX_NONCE_CONTROL_SIGN_FRAME);try{process.stdout.write(await signNonceControlFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Nonce invalidation signing rejected.');process.exitCode=1;});
