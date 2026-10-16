import {readBoundedPipe} from './bounded-pipe';
import {MAX_WETH_SIGN_FRAME} from './weth-conversion-boundary-codec';
import {signWethConversionFrame} from './weth-conversion-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose');const frame=await readBoundedPipe(process.stdin,MAX_WETH_SIGN_FRAME);try{process.stdout.write(await signWethConversionFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('WETH conversion signing rejected.');process.exitCode=1;});
