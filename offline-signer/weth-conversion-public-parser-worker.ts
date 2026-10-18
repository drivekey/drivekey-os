import {parseStrictPublicJson} from '../core/strict-public-json';
import {validateWethConversion} from '../core/weth-conversion-protocol';
import {encodeWethRequestFrame} from './weth-conversion-boundary-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose');const bytes=await readBoundedPipe(process.stdin,8192);process.stdout.write(encodeWethRequestFrame(validateWethConversion(parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),8192),Date.now(),false)));}
main().catch(()=>{process.stderr.write('Public WETH conversion input rejected.');process.exitCode=1;});
