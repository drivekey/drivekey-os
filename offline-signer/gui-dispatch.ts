import {parseStrictPublicJson} from '../core/strict-public-json';
import {guiAction,safeGuiError} from './gui-service';
import {multiOfflineAction} from './multi-service';
import {offlineDashboard} from './dashboard';
import {FILES,validateRequest} from '../core/protocol';
import {readBoundedExchangeBytes} from './exchange-bytes';
import {parseRobinhoodRequestBytes} from './robinhood-isolation';
import {inspectRequest} from './inspection';
import {tradeOfflineAction} from './trade-service';
import {rulesOfflineAction} from './rules-service';
import {savingsSetupOfflineAction} from './savings-setup-service';
import {savingsActionOfflineAction} from './savings-action-service';
import {savingsTransactionOfflineAction} from './savings-transaction-service';
import {robinhoodOfflineAction} from './robinhood-service';
import {wethConversionOfflineAction} from './weth-conversion-service';

// This is a bounded GUI command, not a removable-media request or signing authority.
export function decodeGuiCommand(bytes:Buffer):Record<string,unknown>{
 if(!bytes.length||bytes.length>65536)throw Error('Invalid command size.');
 const value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),65536);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid command.');
 const input=value as Record<string,unknown>;
 if(typeof input.action!=='string'||input.action.length>32||![undefined,'multi','trade','weth-conversion','rules','savings-setup','savings-action','savings-transaction'].includes(input.scope as string|undefined))throw Error('Unsupported command.');
 return input;
}

export async function dispatchGuiCommand(input:Record<string,unknown>,directory:string){
 if(input.scope==='weth-conversion')return {ok:true,...await wethConversionOfflineAction(input,directory)};
 if(input.scope==='savings-transaction')return {ok:true,...await savingsTransactionOfflineAction(input,directory)};
 if(input.scope==='savings-action')return {ok:true,...await savingsActionOfflineAction(input,directory)};
 if(input.scope==='savings-setup')return {ok:true,...await savingsSetupOfflineAction(input,directory)};
 if(input.scope==='rules')return {ok:true,...await rulesOfflineAction(input,directory)};
 if(input.scope==='trade')return {ok:true,...await tradeOfflineAction(input,directory)};
 if(input.scope!==undefined&&input.scope!=='multi')throw Error('Unsupported command scope.');
 if(input.action==='inspect'){
  if(Object.keys(input).some(k=>k!=='action'&&k!=='scope'))throw Error('Invalid inspection command.');
  return {ok:true,...(input.scope==='multi'?{inspection:await inspectRequest(directory,true)}:await robinhoodOfflineAction({action:'inspect'},directory))};
 }
 if(input.action==='dashboard'){
  if(Object.keys(input).length!==1)throw Error('Invalid dashboard command.');
  return {ok:true,...await offlineDashboard(directory)};
 }
 try{return {ok:true,...await(input.scope==='multi'?multiOfflineAction(input,directory):guiAction(input,directory))};}
 catch(error){
  if(input.scope===undefined&&input.action==='review'&&error instanceof Error&&/expired|clock/.test(error.message)){
   const r=validateRequest(await parseRobinhoodRequestBytes(await readBoundedExchangeBytes(directory,FILES.request)),Date.now(),false);
   return {ok:false,error:safeGuiError(error),clock:{now:new Date().toISOString(),created:r.createdAt,expires:r.expiresAt}};
  }
  throw error;
 }
}
