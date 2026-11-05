// Public RPC identity only. No wallet vault/password, signing or broadcast.
import {createHash} from 'node:crypto';
import {AbiCoder,Interface,getAddress,keccak256} from 'ethers';
import {HINKAL_ABI,HINKAL_PIN} from '../engine/core/hinkal-intent';
import {providerVerificationPin} from '../engine/core/hinkal-provider-proof';
import {OnlineAdapter} from './adapter';
const pins=require('../vendor/hinkal/ethereum-provider-verifier-pins.json');
if(createHash('sha256').update(JSON.stringify(pins)).digest('hex')!=='146bb0b496a7d217f2b9db250748f4533d698bed458f450efe5f08322075ec14')throw Error('Ethereum provider verifier pins changed.');
const iface=new Interface(['function verifierMap(uint256) view returns(address)','function verifier() view returns(address)']);
export function providerEvmVerifierPin(data:string){const x=HINKAL_ABI.decodeFunctionData('transact',data),d=x[3],action=x[4].externalActionData.externalActionId,profile=`${d.tokenNumber}x${d.nullifierAmount}x${d.outputAmount}`,row=pins.rows.find((r:any)=>r.profile===profile),id=keccak256(AbiCoder.defaultAbiCoder().encode(['uint16','uint16','uint16','uint256'],[d.tokenNumber,d.nullifierAmount,d.outputAmount,action]));if(!row||action!==0n||id!==row.verifierId||row.canonicalKeySha256!==providerVerificationPin('ethereum',profile).verificationKeyHash)throw Error('Unsupported registered Ethereum private verifier.');return Object.freeze({...row});}
export function assertProviderEvmVerifierSnapshot(data:string,snapshot:{block:string;blockHash:string;poolCodeHash:string;registrationBefore:string;wrapperCodeHash:string;verifier:string;verifierCodeHash:string;registrationAfter:string;finalBlockHash:string}){
 const row=providerEvmVerifierPin(data);if(!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(snapshot.block)||!/^0x[0-9a-f]{64}$/i.test(snapshot.blockHash)||snapshot.poolCodeHash!==HINKAL_PIN.ethereumCodeHash||snapshot.registrationBefore!==row.wrapper||snapshot.wrapperCodeHash!==row.wrapperCodeHash||snapshot.verifier!==row.verifier||snapshot.verifierCodeHash!==row.verifierCodeHash||snapshot.registrationAfter!==row.wrapper||snapshot.finalBlockHash!==snapshot.blockHash)throw Error('Ethereum private verifier block, registration or runtime differs from its pinned proof key.');return {profile:row.profile,block:snapshot.block,blockHash:snapshot.blockHash,wrapper:row.wrapper,verifier:row.verifier,verificationKeyHash:row.canonicalKeySha256};
}
export async function verifyProviderEvmVerifier(adapter:OnlineAdapter,data:string,block='latest'){
 const row=providerEvmVerifierPin(data);await adapter.identity('ethereum');const rpc=(method:string,params:any[])=>adapter.rpc('ethereum',method,params),header=await rpc('eth_getBlockByNumber',[block,false]);
 if(!header||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(header.number)||!/^0x[0-9a-f]{64}$/i.test(header.hash))throw Error('Ethereum private verifier block is unavailable.');const at=header.number;
 const poolCodeHash=keccak256(await rpc('eth_getCode',[HINKAL_PIN.ethereumContract,at]));
 const registered=async()=>getAddress(iface.decodeFunctionResult('verifierMap',await rpc('eth_call',[{to:HINKAL_PIN.ethereumContract,data:iface.encodeFunctionData('verifierMap',[row.verifierId])},at]))[0]);
 const registrationBefore=await registered(),wrapperCodeHash=keccak256(await rpc('eth_getCode',[row.wrapper,at])),verifier=getAddress(iface.decodeFunctionResult('verifier',await rpc('eth_call',[{to:row.wrapper,data:iface.encodeFunctionData('verifier')},at]))[0]),verifierCodeHash=keccak256(await rpc('eth_getCode',[row.verifier,at])),registrationAfter=await registered(),finalBlockHash=(await rpc('eth_getBlockByNumber',[at,false]))?.hash;
 return assertProviderEvmVerifierSnapshot(data,{block:at,blockHash:header.hash,poolCodeHash,registrationBefore,wrapperCodeHash,verifier,verifierCodeHash,registrationAfter,finalBlockHash});
}
