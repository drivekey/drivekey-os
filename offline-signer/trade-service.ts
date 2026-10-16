// OFFLINE ONLY: shares the encrypted multichain vault, never its secret with the web app.
import { z } from 'zod';
import { assertOfflineEnvironment } from './environment';
import { safeDirectory } from '../core/files';
import {offlineNonceSignAction} from './nonce-service';
import {husherOfflineAction} from './husher-service';
import {lifiOfflineAction} from './lifi-service';
import {readBoundedExchangeBytes} from './exchange-bytes';
import {isLifiTradeBytes} from './lifi-isolation';
import {isHusherTradeBytes} from './husher-isolation';
import {isEthNativeTradeBytes} from './eth-native-isolation';
import {ethNativeOfflineAction} from './eth-native-service';
import {isJupiterTradeBytes} from './jupiter-isolation';
import {isExpiringJupiterBytes} from './jupiter-expiring-isolation';
import {expiringJupiterOfflineAction} from './jupiter-expiring-service';
import {isNonceControlBytes} from './nonce-control-isolation';
import {nonceControlOfflineAction} from './nonce-control-service';
import {isNonceTradeBytes} from './nonce-isolation';
import {isEthTradeBytes} from './eth-trade-isolation';
import {ethTradeOfflineAction} from './eth-trade-service';
export const TRADE_FILES={request:'unsigned-trade-request.json',response:'signed-trade-response.json'};
const command=z.discriminatedUnion('action',[
 z.object({scope:z.literal('trade'),action:z.literal('inspect')}).strict(),
 z.object({scope:z.literal('trade'),action:z.literal('sign'),password:z.string().max(256),fingerprint:z.string(),consent:z.literal(true)}).strict(),
]);
export async function tradeOfflineAction(input:unknown,directory:string) {
 const c=command.parse(input);await assertOfflineEnvironment();await safeDirectory(directory);
 // Route before JSON/transaction parsing in this broker. Parser failure is fatal,
 // never a fallback into a legacy in-process signer. LI.FI keeps these exact bytes.
 const requestBytes=await readBoundedExchangeBytes(directory,TRADE_FILES.request);
 if(await isExpiringJupiterBytes(requestBytes))return expiringJupiterOfflineAction(c,directory,requestBytes);
 if(await isNonceControlBytes(requestBytes))return nonceControlOfflineAction(c,directory,requestBytes);
 if(await isLifiTradeBytes(requestBytes))return lifiOfflineAction(c,directory,requestBytes);
 if(await isHusherTradeBytes(requestBytes))return husherOfflineAction(c,directory,requestBytes);
 if(await isEthNativeTradeBytes(requestBytes))return ethNativeOfflineAction(c,directory,requestBytes);
 if(await isJupiterTradeBytes(requestBytes))throw Error('Historical Jupiter v4 approvals are recovery-only. Prepare a swap with on-chain expiry.');
 if(await isNonceTradeBytes(requestBytes))return offlineNonceSignAction(c,directory,requestBytes);
 if(await isEthTradeBytes(requestBytes))return ethTradeOfflineAction(c,directory,requestBytes);
 // All current supported trade formats use a fixed parser/key boundary. A
 // malformed, lying or unsupported route can never reach an in-process signer.
 throw Error('Unsupported request in isolated trade routing.');
}
