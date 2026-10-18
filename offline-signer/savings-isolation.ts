import {runSandbox} from './sandbox-process';
import {decodeSetupFrame,decodeVaultFrame,encodeSetupSigningFrame,decodeProofSignature} from './savings-boundary-codec';
import {type SetupPurpose} from '../core/savings-setup';
const node='/opt/drivekey/node/bin/node';
const parser='/opt/drivekey/drivekey-savings-public-parser.cjs';
const signer='/opt/drivekey/drivekey-savings-key-worker.cjs';
export async function parseSavingsSetupBytes(bytes:Buffer){
 return decodeSetupFrame(await runSandbox({node,program:parser,args:['setup'],inputLimit:32768,outputLimit:512,timeoutMs:10000,heapMb:64},bytes));
}
export async function parseEncryptedVaultBytes(bytes:Buffer){
 return decodeVaultFrame(await runSandbox({node,program:parser,args:['vault'],inputLimit:32768,outputLimit:512,timeoutMs:10000,heapMb:64},bytes));
}
export async function isolatedSetupSignature(setup:unknown,vault:unknown,purpose:SetupPurpose,fingerprint:string,password:string){
 const frame=encodeSetupSigningFrame(setup,vault,purpose,fingerprint,password);
 try{return decodeProofSignature(await runSandbox({node,program:signer,args:[],inputLimit:2048,outputLimit:73,timeoutMs:90000,heapMb:128},frame));}
 finally{frame.fill(0);}
}
