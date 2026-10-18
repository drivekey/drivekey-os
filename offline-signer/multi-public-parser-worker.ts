// One bounded public input. No passphrase, filesystem path or key handling.
import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateMultiRequest} from '../core/multi-protocol';
import {encodeMultiRequestFrame} from './multi-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='multi-request')throw Error('Unsupported purpose.');
 const bytes=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 process.stdout.write(encodeMultiRequestFrame(validateMultiRequest(value,Date.now(),false)));
}
main().catch(()=>{process.stderr.write('Public transfer input rejected.');process.exitCode=1;});
