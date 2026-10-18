import {readBoundedPipe} from './bounded-pipe';
import {MAX_ETH_TRADE_SIGN_FRAME} from './eth-trade-boundary-codec';
import {signEthTradeFrame} from './eth-trade-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const frame=await readBoundedPipe(process.stdin,MAX_ETH_TRADE_SIGN_FRAME);try{process.stdout.write(await signEthTradeFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Ethereum trade signing rejected.');process.exitCode=1;});
