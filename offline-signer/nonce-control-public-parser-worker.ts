import {parseStrictPublicJson} from '../core/strict-public-json';
import {isNonceControlShape,validateNonceControl} from '../core/solana-nonce-control';
import {encodeNonceControlRequestFrame} from './nonce-control-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){if(process.argv.length!==3||!['nonce-control-route','nonce-control-request'].includes(process.argv[2]))throw Error();const limit=process.argv[2]==='nonce-control-route'?32768:8192,bytes=await readBoundedPipe(process.stdin,limit),value=parseStrictPublicJson(new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes),limit);if(process.argv[2]==='nonce-control-route'){process.stdout.write(Buffer.concat([Buffer.from('DKNCNRT1'),Buffer.from([isNonceControlShape(value)?1:0])]));return;}process.stdout.write(encodeNonceControlRequestFrame(validateNonceControl(value,Date.now(),false)));}
main().catch(()=>{process.stderr.write('Nonce-control public input rejected.');process.exitCode=1;});
