import {readBoundedPipe} from './bounded-pipe';
import {runLifecycleFrame} from './lifecycle-key-core';
import {LIFECYCLE_MAX_COMMAND} from './lifecycle-boundary-codec';
import {installLifecycleNativeKdf} from './lifecycle-native-kdf';
async function main(){if(process.argv.length!==2)throw Error('Unsupported lifecycle key invocation.');installLifecycleNativeKdf();const input=await readBoundedPipe(process.stdin,LIFECYCLE_MAX_COMMAND);try{process.stdout.write(await runLifecycleFrame(input));}finally{input.fill(0);}}
main().catch(()=>{process.stderr.write('Lifecycle key operation rejected.');process.exitCode=1;});
