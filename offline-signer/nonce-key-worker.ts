import {readBoundedPipe} from './bounded-pipe';
import {MAX_NONCE_SIGN_FRAME} from './nonce-boundary-codec';
import {signNonceFrame} from './nonce-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const frame=await readBoundedPipe(process.stdin,MAX_NONCE_SIGN_FRAME);try{process.stdout.write(await signNonceFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Nonce setup signing rejected.');process.exitCode=1;});
