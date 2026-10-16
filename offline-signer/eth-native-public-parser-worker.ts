// One public-file parser per process. No paths, passwords or key access.
import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateTrade} from '../core/trade-protocol';
import {isEthNativeTradeShape,encodeEthNativeRequestFrame} from './eth-native-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){
 if(process.argv.length!==3||!['eth-native-route','eth-native-request'].includes(process.argv[2]))throw Error('Unsupported purpose.');
 const bytes=await readBoundedPipe(process.stdin,32768),value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),32768);
 if(process.argv[2]==='eth-native-route'){process.stdout.write(Buffer.concat([Buffer.from('DKENATT1'),Buffer.from([isEthNativeTradeShape(value)?1:0])]));return;}
 // Expired requests remain inspectable; the key core always checks expiry.
 process.stdout.write(encodeEthNativeRequestFrame(validateTrade(value,Date.now(),false)));
}
main().catch(()=>{process.stderr.write('Public native payment input rejected.');process.exitCode=1;});
