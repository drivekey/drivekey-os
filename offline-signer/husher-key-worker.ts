import {readBoundedPipe} from './bounded-pipe';
import {MAX_HUSHER_SIGN_FRAME} from './husher-boundary-codec';
import {signHusherFrame} from './husher-key-core';
async function main(){
 if(process.argv.length!==2)throw Error('Unsupported Husher signing invocation.');
 const frame=await readBoundedPipe(process.stdin,MAX_HUSHER_SIGN_FRAME);
 try{process.stdout.write(await signHusherFrame(frame));}finally{frame.fill(0);}
}
main().catch(()=>{process.stderr.write('Husher signing rejected.');process.exitCode=1;});
