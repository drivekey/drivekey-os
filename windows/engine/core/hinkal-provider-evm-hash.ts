// Pure public calldata reconstruction; no network or wallet unlock.
import {HINKAL_ABI,HINKAL_PIN} from './hinkal-intent';
import {HINKAL_SCALAR} from './hinkal-groth16';
const {preProcessing}=require('../../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{createCallDataHash}=require('../../node_modules/@hinkal/common/common/src/functions/snarkjs/common.snarkjs.cjs'),{computeSignedMessageHashEvm}=require('../../node_modules/@hinkal/common/common/src/functions/snarkjs/signedMessageHash.cjs');
export async function providerEvmSignedMessageHash(data:string){
 await preProcessing();const d=HINKAL_ABI.decodeFunctionData('transact',data)[4],ext=d.externalActionData,fee=d.feeStructure,hook=d.hookData;
 const hash=createCallDataHash(Number(d.publicSignalCount),d.relay,ext.externalAddress,ext.externalActionId,d.emporiumMessage,ext.externalActionMetadata,d.encryptedOutputs.toArray(true),d.onChainEncryptedOutput,{preHookContract:hook.preHookContract,postHookContract:hook.postHookContract,preHookMetadata:hook.preHookMetadata,postHookMetadata:hook.postHookMetadata},d.slippageValues.toArray(true),d.onChainCreation.toArray(true),{feeToken:fee.feeToken,flatFee:fee.flatFee,variableRate:fee.variableRate},d.originalSender,d.extraData,1,false);
 if(BigInt(hash)!==d.calldataHash)throw Error('Ethereum private calldata hash differs from its exact transaction.');
 return BigInt(computeSignedMessageHashEvm({chainId:1n,verifyingContract:HINKAL_PIN.ethereumContract,rootHashHinkal:d.rootHashHinkal,erc20TokenAddresses:d.erc20TokenAddresses.toArray(true),amountChanges:d.amountChanges.map((n:bigint)=>n<0n?HINKAL_SCALAR+n:n),outTimeStamp:d.timeStamp,inNullifiers:d.inputNullifiers.toArray(true),outCommitments:d.outCommitments.toArray(true),calldataHash:d.calldataHash,message:d.emporiumMessage,outH1Ax:d.stealthAddressStructure.H1x,outH1Ay:d.stealthAddressStructure.H1y,H0Ax:d.stealthAddressStructure.H0x,H0Ay:d.stealthAddressStructure.H0y}));
}
