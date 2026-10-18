import {readBoundedPipe} from './bounded-pipe';
import {RULES_COMMAND_MAX} from './rules-boundary-codec';
import {signRulesFrame} from './rules-key-core';
import {installLifecycleNativeKdf} from './lifecycle-native-kdf';
async function main(){if(process.argv.length!==2)throw Error('Unsupported rules key invocation');installLifecycleNativeKdf();const frame=await readBoundedPipe(process.stdin,RULES_COMMAND_MAX);try{process.stdout.write(await signRulesFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Rules signing rejected.');process.exitCode=1;});
