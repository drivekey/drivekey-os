import {readBoundedPipe} from './bounded-pipe';
import {MAX_LIFI_SIGN_FRAME} from './lifi-boundary-codec';
import {signLifiFrame} from './lifi-key-core';
async function main(){
 if(process.argv.length!==2)throw Error('Unsupported purpose.');
 const input=await readBoundedPipe(process.stdin,MAX_LIFI_SIGN_FRAME);
 try{process.stdout.write(await signLifiFrame(input));}finally{input.fill(0);}
}
main().catch(()=>{process.stderr.write('LI.FI signing rejected.');process.exitCode=1;});
