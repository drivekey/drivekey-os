// Encrypted/public media parsing only. Never receives a passphrase or plaintext key.
import {readBoundedPipe} from './bounded-pipe';
import {parseStrictPublicJson} from '../core/strict-public-json';
import {lifecycleVaultFrame} from './lifecycle-boundary-codec';
async function main(){
 const purpose=process.argv[2];if(process.argv.length!==3||!['lifecycle-v2','lifecycle-v3'].includes(purpose))throw Error('Unsupported lifecycle parser.');
 const bytes=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 process.stdout.write(lifecycleVaultFrame(purpose==='lifecycle-v2'?'v2':'v3',value));
}
main().catch(()=>{process.stderr.write('Lifecycle encrypted input rejected.');process.exitCode=1;});
