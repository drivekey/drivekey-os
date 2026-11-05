'use strict';
const {authorizePayment}=require('./acceptance-policy.cjs');
function authorizeRecipientReturn(m,state,identity,validatePayment,now=Date.now()){
 const r=validatePayment(m.request,now);
 if(m.kind!=='disposable-payment-authorization'||m.signingRole!=='recipient'||m.purpose!=='return-test-funding'||r.version!==8||r.chain!=='solana'||r.asset!=='SOL'||r.from!==identity.recipient.solanaAddress||r.deviceId!==identity.recipient.deviceId||r.recipient!==identity.source.solanaAddress||m.source!==r.from||m.destination!==r.recipient||m.genesisHash!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'||BigInt(r.amount)>1000000n)throw Error('Only a bounded native refund from the controlled test recipient to the test source is authorized.');
 const op=authorizePayment(m,state,{...identity,source:identity.recipient,recipient:identity.source,tokenRecipient:identity.source},validatePayment,now);return {...op,signingRole:'recipient',purpose:'return-test-funding'};
}
module.exports={authorizeRecipientReturn};
