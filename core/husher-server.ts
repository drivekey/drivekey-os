import {boundedRpcCall} from './rpc-proxy';
import 'server-only';
import {HusherLedger} from './husher-ledger';
import {WalletSubmissionLedger} from './wallet-submission-ledger';
import type {Rpc} from './protocol';
const methods=new Set(['eth_chainId','eth_getCode','eth_getStorageAt','eth_call','eth_getTransactionCount','eth_estimateGas','eth_getBlockByNumber','eth_maxPriorityFeePerGas','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash']);
export function husherServer(write=false,options:{readWalletJournal?:boolean}={}){
 const url=process.env.HUSHER_DATABASE_URL;if(!url)throw Error('Husher ledger is not configured.');
 const store=new HusherLedger(url,'drivekey-owner');
 let walletStore:WalletSubmissionLedger|undefined;
 if(write||options.readWalletJournal){const database=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;if(!database||!scope)throw Error('Shared wallet submission storage is not configured.');walletStore=new WalletSubmissionLedger(database,scope);}
 const rpc:Rpc=async(method,params=[])=>{
  if(!methods.has(method)&&!(write&&method==='eth_sendRawTransaction'))throw Error('Unsupported Husher RPC operation.');
  const endpoint=process.env.ETHEREUM_RPC_URL;if(!endpoint)throw Error('Private Ethereum RPC is not configured.');
  try{return await boundedRpcCall(endpoint,method,params);}
  catch{throw Error('Ethereum RPC did not verify the operation. Reconcile any saved submission; never retry sending automatically.');}
 };
 return {store,rpc,key:process.env.HUSHER_API_KEY,walletStore};
}
