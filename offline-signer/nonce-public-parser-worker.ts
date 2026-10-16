import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateOfflineNonce} from '../core/offline-nonce-protocol';
import {isNonceTradeShape,encodeNonceRequestFrame} from './nonce-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){if(process.argv.length!==3||!['nonce-route','nonce-request'].includes(process.argv[2]))throw Error('Unsupported purpose.');const bytes=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);if(process.argv[2]==='nonce-route'){process.stdout.write(Buffer.concat([Buffer.from('DKNONRT5'),Buffer.from([isNonceTradeShape(value)?1:0])]));return;}process.stdout.write(encodeNonceRequestFrame(await validateOfflineNonce(value,Date.now(),false)));}
main().catch(()=>{process.stderr.write('Public nonce setup input rejected.');process.exitCode=1;});
