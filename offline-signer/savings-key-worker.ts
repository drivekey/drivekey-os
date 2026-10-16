import {readBoundedPipe} from './bounded-pipe';
import {MAX_SIGN_FRAME} from './savings-boundary-codec';
import {signSetupFrame} from './savings-key-core';
async function main(){
 if(process.argv.length!==2)throw Error('Invalid signing entry point.');
 const frame=await readBoundedPipe(process.stdin,MAX_SIGN_FRAME);
 try{process.stdout.write(await signSetupFrame(frame));}finally{frame.fill(0);}
}
main().catch(()=>{process.stderr.write('Setup signing rejected.');process.exitCode=1;});
