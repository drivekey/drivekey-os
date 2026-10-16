import {runSandbox} from './sandbox-process';
import {decodeTradeRouteFrame,decodeLifiRequestFrame,encodeLifiSigningFrame,decodeLifiResponseFrame,
 MAX_LIFI_REQUEST_FRAME,MAX_LIFI_SIGN_FRAME,MAX_LIFI_RESPONSE_FRAME} from './lifi-boundary-codec';
const node='/opt/drivekey/node/bin/node',parser='/opt/drivekey/drivekey-lifi-public-parser.cjs',signer='/opt/drivekey/drivekey-lifi-key-worker.cjs';
export async function isLifiTradeBytes(bytes:Buffer){
 return decodeTradeRouteFrame(await runSandbox({node,program:parser,args:['trade-route'],inputLimit:32768,outputLimit:9,timeoutMs:10000,heapMb:64},bytes));
}
export async function parseLifiRequestBytes(bytes:Buffer){
 return decodeLifiRequestFrame(await runSandbox({node,program:parser,args:['lifi-request'],inputLimit:32768,outputLimit:MAX_LIFI_REQUEST_FRAME,timeoutMs:10000,heapMb:64},bytes));
}
export async function isolatedLifiResponse(request:unknown,vault:unknown,fingerprint:string,password:string){
 const frame=encodeLifiSigningFrame(request,vault,fingerprint,password);
 try{return decodeLifiResponseFrame(await runSandbox({node,program:signer,args:[],inputLimit:MAX_LIFI_SIGN_FRAME,outputLimit:MAX_LIFI_RESPONSE_FRAME,timeoutMs:90000,heapMb:128},frame));}
 finally{frame.fill(0);}
}
