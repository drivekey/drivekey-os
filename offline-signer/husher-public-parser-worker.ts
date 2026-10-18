// PUBLIC PARSER ONLY. Hostile JSON/media parsing happens without keys or files.
import {readBoundedPipe} from './bounded-pipe';
import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateHusherDeposit} from '../core/husher-deposit-protocol';
import {encodeHusherRequestFrame} from './husher-boundary-codec';
async function main(){
 const purpose=process.argv[2];if(process.argv.length!==3||!['husher-route','husher-request'].includes(purpose))throw Error('Unsupported parser purpose.');
 const bytes=await readBoundedPipe(process.stdin,32768);
 const value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 if(purpose==='husher-route')process.stdout.write(Buffer.concat([Buffer.from('DKHUSHT8'),Buffer.from([!!value&&typeof value==='object'&&'version' in value&&value.version===8?1:0])]));
 else process.stdout.write(encodeHusherRequestFrame(validateHusherDeposit(value,Date.now(),false)));
}
main().catch(()=>{process.stderr.write('Husher public request rejected.');process.exitCode=1;});
