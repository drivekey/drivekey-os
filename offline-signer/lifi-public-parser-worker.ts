// One public-file parser per process. No passwords, vault keys, file paths or network API.
import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateLifiRequest} from '../core/lifi-protocol';
import {encodeLifiRequestFrame} from './lifi-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){
 if(process.argv.length!==3||!['trade-route','lifi-request'].includes(process.argv[2]))throw Error('Unsupported purpose.');
 const bytes=await readBoundedPipe(process.stdin,32768);
 const value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 if(process.argv[2]==='trade-route'){
  const lifi=!!value&&typeof value==='object'&&'version' in value&&value.version===9;
  process.stdout.write(Buffer.concat([Buffer.from('DKROUTE1'),Buffer.from([lifi?1:0])]));return;
 }
 // Expired requests remain inspectable; the signing core always checks expiry.
 process.stdout.write(encodeLifiRequestFrame(validateLifiRequest(value,Date.now(),false)));
}
main().catch(()=>{process.stderr.write('Public LI.FI input rejected.');process.exitCode=1;});
