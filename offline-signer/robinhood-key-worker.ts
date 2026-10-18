import {readBoundedPipe} from './bounded-pipe';
import {MAX_ROBINHOOD_SIGN_FRAME} from './robinhood-boundary-codec';
import {signRobinhoodFrame} from './robinhood-key-core';
import {installLifecycleNativeKdf} from './lifecycle-native-kdf';
async function main(){if(process.argv.length!==2)throw Error('Unsupported signing invocation.');installLifecycleNativeKdf();const frame=await readBoundedPipe(process.stdin,MAX_ROBINHOOD_SIGN_FRAME);try{process.stdout.write(await signRobinhoodFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Robinhood signing rejected.');process.exitCode=1;});
