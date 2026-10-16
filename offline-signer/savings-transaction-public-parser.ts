import {parseSavingsTransactionFile} from '../core/savings-transaction';
import {encodeSavingsTransactionFrame} from './savings-transaction-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){if(process.argv.length!==2)throw Error('Unsupported purpose.');const bytes=await readBoundedPipe(process.stdin,32768);const input=parseSavingsTransactionFile(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));process.stdout.write(encodeSavingsTransactionFrame(input));}
main().catch(()=>{process.stderr.write('Savings transaction input rejected.');process.exitCode=1;});
