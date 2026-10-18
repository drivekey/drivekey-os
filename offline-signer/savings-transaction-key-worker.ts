import {readBoundedPipe} from './bounded-pipe';
import {MAX_SAVINGS_TRANSACTION_SIGN_FRAME} from './savings-transaction-codec';
import {signSavingsTransactionFrame} from './savings-transaction-key-core';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const frame=await readBoundedPipe(process.stdin,MAX_SAVINGS_TRANSACTION_SIGN_FRAME);try{process.stdout.write(await signSavingsTransactionFrame(frame));}finally{frame.fill(0);}}
main().catch(()=>{process.stderr.write('Savings transaction signing rejected.');process.exitCode=1;});
