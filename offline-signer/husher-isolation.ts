import {runSandbox} from './sandbox-process';
import {decodeHusherRouteFrame,decodeHusherRequestFrame,encodeHusherSigningFrame,decodeHusherResponseFrame,MAX_HUSHER_REQUEST_FRAME,MAX_HUSHER_SIGN_FRAME,MAX_HUSHER_RESPONSE_FRAME} from './husher-boundary-codec';
const node='/opt/drivekey/node/bin/node',parser='/opt/drivekey/drivekey-husher-public-parser.cjs',signer='/opt/drivekey/drivekey-husher-key-worker.cjs';
export async function isHusherTradeBytes(bytes:Buffer){
 return decodeHusherRouteFrame(await runSandbox({node,program:parser,args:['husher-route'],inputLimit:32768,outputLimit:9,timeoutMs:10000,heapMb:64},bytes));
}
export async function parseHusherRequestBytes(bytes:Buffer){
 return decodeHusherRequestFrame(await runSandbox({node,program:parser,args:['husher-request'],inputLimit:32768,outputLimit:MAX_HUSHER_REQUEST_FRAME,timeoutMs:10000,heapMb:64},bytes));
}
export async function isolatedHusherResponse(request:unknown,vault:unknown,fingerprint:string,password:string){
 const frame=encodeHusherSigningFrame(request,vault,fingerprint,password);
 try{return decodeHusherResponseFrame(await runSandbox({node,program:signer,args:[],inputLimit:MAX_HUSHER_SIGN_FRAME,outputLimit:MAX_HUSHER_RESPONSE_FRAME,timeoutMs:90000,heapMb:128},frame));}
 finally{frame.fill(0);}
}
