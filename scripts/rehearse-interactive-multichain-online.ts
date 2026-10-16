// In-memory adapters only. No network transport or durable-storage claim.
import assert from 'node:assert/strict';
import {PublicKey,SystemProgram,VersionedTransaction,type Connection} from '@solana/web3.js';
import {Transaction,toQuantity} from 'ethers';
import {multiAction} from '../core/multi-service';
import {submitTrade,type TradeAttempt} from '../core/trade-submission';
import type {WalletSubmissionStore,WalletSubmissionClaim} from '../core/wallet-submission-ledger';
import type {Rpc} from '../core/protocol';
export async function rehearseMultichainOnline(kind:string,wallet:any,request:any,response:any){
 let sends=0,finalized=false;
 if(kind==='solana-native'){
  const bytes=Buffer.from(response.rawSignedTransaction,'base64'),tx=VersionedTransaction.deserialize(bytes),data=Buffer.alloc(80);
  data.writeUInt32LE(1,0);data.writeUInt32LE(1,4);Buffer.from(new PublicKey(request.from).toBytes()).copy(data,8);Buffer.from(new PublicKey(request.nonceValue).toBytes()).copy(data,40);data.writeBigUInt64LE(5000n,72);
  const sol={getGenesisHash:async()=>request.genesisHash,getAccountInfo:async(address:PublicKey)=>{assert.equal(address.toBase58(),request.nonceAccount);return {data,owner:SystemProgram.programId,lamports:2000000,executable:false};},getFeeForMessage:async()=>({value:5000}),getBalance:async()=>1000000000,
   getSignatureStatuses:async()=>({value:[finalized?{confirmationStatus:'finalized',slot:42,err:null}:null]}),getTransaction:async()=>({slot:42,meta:{err:null},transaction:{signatures:[response.transactionHash],message:tx.message}}),
   simulateTransaction:async(actual:VersionedTransaction)=>{assert.deepEqual(Buffer.from(actual.serialize()),bytes);return {value:{err:null}};},
   sendRawTransaction:async(actual:Buffer)=>{assert.deepEqual(actual,bytes);sends++;return response.transactionHash;}}as unknown as Connection;
  const rpc:Rpc=async()=>{throw Error('Unexpected Ethereum RPC in SOL rehearsal');};let claim:WalletSubmissionClaim|null=null;const store:WalletSubmissionStore={read:async(identity)=>claim&&claim.kind==='solana-durable'&&identity.family==='solana'&&claim.signature===identity.signature&&claim.genesis===identity.genesis?claim:null,claim:async(record)=>{assert.equal(record.kind,'solana-durable');if(claim)return false;claim=structuredClone(record);return true;}};const action={action:'broadcast',wallet,request,response,consent:true};
  await assert.rejects(multiAction({...action,consent:false},rpc,sol,true,store));assert.equal(sends,0);
  assert.equal((await multiAction(action,rpc,sol,false,store)as any).state,'verified-only');assert.equal(sends,0);
  assert.equal((await multiAction({action:'preflight',wallet,request,response},rpc,sol,false,store)as any).state,'ready');
  assert.equal((await multiAction(action,rpc,sol,true,store)as any).state,'submitted');assert.equal(sends,1);
  finalized=true;assert.equal((await multiAction({action:'status',wallet,request,response},rpc,sol,false,store)as any).state,'confirmed');
  assert.equal((await multiAction(action,rpc,sol,true,store)as any).state,'confirmed');assert.equal(sends,1);
 }else{
  assert.equal(kind,'ethereum-native');const tx=Transaction.from(response.rawSignedTransaction),blockHash='0x'+'ab'.repeat(32);
  const actual={hash:tx.hash,from:tx.from,to:tx.to,input:tx.data,value:toQuantity(tx.value),nonce:toQuantity(tx.nonce),chainId:'0x1',type:'0x2',gas:toQuantity(tx.gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!),accessList:tx.accessList,blockHash,blockNumber:'0x10'};
  const values:Record<string,unknown>={eth_chainId:'0x1',eth_getTransactionCount:toQuantity(tx.nonce),eth_getBalance:'0xde0b6b3a7640000',eth_estimateGas:'0x5208',eth_call:'0x'};
  const rpc:Rpc=async(method,params)=>{
   if(method==='eth_sendRawTransaction'){assert.deepEqual(params,[response.rawSignedTransaction]);sends++;return tx.hash;}
   if(method==='eth_getTransactionByHash')return finalized?actual:null;
   if(method==='eth_getTransactionReceipt')return finalized?{transactionHash:tx.hash,status:'0x1',blockHash,blockNumber:'0x10',logs:[]}:null;
   if(method==='eth_getBlockByNumber')return {hash:blockHash,number:'0x10',baseFeePerGas:'0x3b9aca00',timestamp:toQuantity(Math.floor(Date.parse(request.createdAt)/1000))};
   assert.ok(Object.hasOwn(values,method));return values[method];
  };
  let saved:TradeAttempt|null=null;const store={read:async()=>saved,write:async(value:TradeAttempt)=>{saved=value;}};const action={wallet,request,response,consent:true};
  await assert.rejects(submitTrade({...action,consent:false},rpc,store,true));assert.equal(sends,0);
  await assert.rejects(submitTrade(action,rpc,store,false));assert.equal(sends,0);
  assert.equal((await submitTrade(action,rpc,store,true)).state,'submitted');assert.equal(sends,1);
  finalized=true;assert.equal((await submitTrade({...action,consent:false},rpc,store,false)).state,'confirmed');
  assert.equal((await submitTrade(action,rpc,store,true)).state,'confirmed');assert.equal(sends,1);
 }
 return {missingConsentRejected:true,disabledGatePreventsSend:true,exactSyntheticSend:true,syntheticFinalizedReconciliation:true,noDuplicateSend:true,syntheticRPCSendCount:sends,persistentStorageIntegration:false,externalRPCRequests:0,actualChainSettlement:false};
}
