import {ownHinkalEvmNote} from '../engine/core/hinkal-evm-note';
// Networking holds only view capability and the public EdDSA spending key.
// It cannot authorize a proof, sign a chain transaction or submit to a relayer.
import {randomBytes} from 'node:crypto';
import {getAddress,getBytes} from 'ethers';
import {z} from 'zod';
import {CHAINS} from '../engine/core/payment-intent';
import {HINKAL_PIN,HINKAL_ABI} from '../engine/core/hinkal-intent';
import {hinkalProofContextSchema,validateHinkalProofContext,hinkalProofRequest} from '../engine/core/hinkal-proof-job';
const {preProcessing}=require('../node_modules/@hinkal/common/common/src/crypto/preProcessing.cjs'),{decryptUtxo}=require('../node_modules/@hinkal/common/common/src/data-structures/crypto-keys/encryptDecryptUtxo.cjs'),{toSpeculativeUtxo}=require('../node_modules/@hinkal/common/common/src/functions/pre-transaction/speculativeUtxo.cjs'),{prepareTxEnclaveCall,finalizeTxEnclaveCall}=require('../node_modules/@hinkal/common/common/src/functions/snarkjs/constructTxEnclave.cjs');
const zero='0x0000000000000000000000000000000000000000',uint=z.string().regex(/^(0|[1-9][0-9]*)$/).max(78);
const context=hinkalProofContextSchema;
const viewSchema=z.object({chain:z.literal('ethereum'),address:z.string(),nullifyingKey:z.string().regex(/^0x[0-9a-f]+$/).max(66),spendingPublicKey:z.tuple([uint,uint]),readOnly:z.literal(true),testOnly:z.literal(true)}).strict();
export async function prepareHinkalProof(input:unknown){
 const p=z.object({context,view:viewSchema}).strict().parse(input),c=validateHinkalProofContext(p.context);if(getAddress(p.view.address)!==getAddress(c.from))throw Error('Hinkal view belongs to another source.');
 await preProcessing();const key={getShieldedPrivateKey:()=>p.view.nullifyingKey,getSpendingKeyPair:()=>({pubSpendingBJJPoint:p.view.spendingPublicKey.map(BigInt)}),signEddsa:()=>{throw Error('Proof authorization is offline only.');}},token=c.asset==='ETH'?zero:CHAINS.ethereum.usdc,notes=c.inputNotes.map(n=>ownHinkalEvmNote(n,key,token));
 if(notes.some(n=>getAddress(n.erc20TokenAddress)!==getAddress(token))||c.action!=='deposit'&&notes.reduce((n,u)=>n+u.amount,0n)<BigInt(c.amount))throw Error('Private inputs differ from requested asset/amount.');
 const request=hinkalProofRequest(c,notes,BigInt('0x'+randomBytes(16).toString('hex')).toString());
 // SDK performs signed-envelope verification and reconstructs the job hash. The
 // offline worker repeats semantic/hash reconstruction with its own key material.
 const response=await prepareTxEnclaveCall({userKeys:key},request,key);return {version:1,kind:'hinkal-unsigned-proof-job',context:c,request,response,proofAuthorized:false,blockchainTransactionSigned:false,submitted:false};
}
export async function finalizeHinkalProof(input:unknown){
 const p=z.object({context,jobId:z.string().min(1).max(256),authorization:z.object({R8:z.tuple([uint,uint]),S:uint}).strict()}).strict().parse(input);await preProcessing();const proof=await finalizeTxEnclaveCall(p.jobId,{R8:p.authorization.R8.map(BigInt),S:BigInt(p.authorization.S)}),transaction={to:HINKAL_PIN.ethereumContract,value:p.context.action==='deposit'&&p.context.asset==='ETH'?p.context.amount:'0',data:HINKAL_ABI.encodeFunctionData('transact',[...proof.zkCallData.slice(0,3),proof.dimData,proof.circomData])};return {transaction,proofAuthorizationProvided:true,blockchainTransactionSigned:false,submitted:false};
}
