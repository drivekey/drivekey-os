import {validateMultiRequest} from './multi-protocol';
import {SOL_USDC} from './payment-request';
export function isSolPayment(request:unknown){return !!request&&typeof request==='object'&&'version' in request&&request.version===3&&'network' in request&&request.network==='solana';}
export function validateSolPayment(request:unknown,now=Date.now(),expiry=true){
 const r=validateMultiRequest(request,now,expiry);
 if(r.network!=='solana'||!(r.standard==='native'||r.token===SOL_USDC&&r.decimals===6))throw Error('Only SOL and USDC payments are supported in this candidate.');
 return r;
}
