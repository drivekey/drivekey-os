// Public JSON only, confined without media paths or decrypted keys.
import {readBoundedPipe} from './bounded-pipe';
import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateRequest} from '../core/protocol';
import {encodeRobinhoodRequestFrame,encodeRobinhoodVaultFrame} from './robinhood-boundary-codec';
async function main(){
 const purpose=process.argv[2];if(process.argv.length!==3||!['robinhood-request','robinhood-vault'].includes(purpose))throw Error('Unsupported parser purpose.');
 const raw=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),32768);
 process.stdout.write(purpose==='robinhood-request'?encodeRobinhoodRequestFrame(validateRequest(value,Date.now(),false)):encodeRobinhoodVaultFrame(value));
}
main().catch(()=>{process.stderr.write('Robinhood public input rejected.');process.exitCode=1;});
