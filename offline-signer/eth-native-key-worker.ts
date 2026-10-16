import {readBoundedPipe} from './bounded-pipe';
import {MAX_ETH_NATIVE_SIGN_FRAME} from './eth-native-boundary-codec';
import {signEthNativeFrame} from './eth-native-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const frame=await readBoundedPipe(process.stdin,MAX_ETH_NATIVE_SIGN_FRAME);try{process.stdout.write(await signEthNativeFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Native payment signing rejected.');process.exitCode=1;});
