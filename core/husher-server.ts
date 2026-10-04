import 'server-only';
import {HusherLedger} from './husher-ledger';
import type {Rpc} from './protocol';
const methods=new Set(['eth_chainId','eth_getCode','eth_getStorageAt','eth_call','eth_getTransactionCount','eth_estimateGas','eth_getBlockByNumber','eth_maxPriorityFeePerGas','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash']);
export function husherServer(write=false){
 const url=process.env.HUSHER_DATABASE_URL;if(!url)throw Error('Husher ledger is not configured.');
 const store=new HusherLedger(url,'drivekey-owner');
 const rpc:Rpc=async(method,params=[])=>{
  if(!methods.has(method)&&!(write&&method==='eth_sendRawTransaction'))throw Error('Unsupported Husher RPC operation.');
  const endpoint=process.env.ETHEREUM_RPC_URL;if(!endpoint)throw Error('Private Ethereum RPC is not configured.');
  try{const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!result.ok)throw Error();const reader=result.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder();
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();const data=JSON.parse(text);if(data.error||data.id!==1||!('result' in data))throw Error();return data.result;
  }catch{throw Error('Ethereum RPC did not verify the operation. Reconcile any saved submission; never retry sending automatically.');}
 };
 return {store,rpc,key:process.env.HUSHER_API_KEY};
}
