import {runSandbox} from './sandbox-process';
import {decodeSavingsTransactionFrame,encodeSavingsTransactionSigningFrame,decodeSavingsTransactionResponseFrame,MAX_SAVINGS_TRANSACTION_FRAME,MAX_SAVINGS_TRANSACTION_SIGN_FRAME,MAX_SAVINGS_TRANSACTION_RESPONSE_FRAME} from './savings-transaction-codec';
const node='/opt/drivekey/node/bin/node',parser='/opt/drivekey/drivekey-savings-transaction-public-parser.cjs',signer='/opt/drivekey/drivekey-savings-transaction-key-worker.cjs';
export async function parseSavingsTransactionBytes(bytes:Buffer){return decodeSavingsTransactionFrame(await runSandbox({node,program:parser,args:[],inputLimit:32768,outputLimit:MAX_SAVINGS_TRANSACTION_FRAME,timeoutMs:10000,heapMb:64},bytes));}
export async function isolatedSavingsTransactionResponse(request:unknown,vault:unknown,fingerprint:string,password:string){
 const frame=encodeSavingsTransactionSigningFrame(request,vault,fingerprint,password);
 try{return decodeSavingsTransactionResponseFrame(await runSandbox({node,program:signer,args:[],inputLimit:MAX_SAVINGS_TRANSACTION_SIGN_FRAME,outputLimit:MAX_SAVINGS_TRANSACTION_RESPONSE_FRAME,timeoutMs:90000,heapMb:128},frame));}finally{frame.fill(0);}
}
