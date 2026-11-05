'use strict';
// Public provider-proof operations, with durable uncertainty and no retry/reset.
const {isDeepStrictEqual}=require('node:util'),{createHash}=require('node:crypto');
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex'),snapshot=x=>JSON.parse(JSON.stringify(x));
const uncertain='Provider finalization outcome is uncertain. Preserve the original proof authorization and attempt; new wallet signing and automatic finalization repeats are disabled.';
class ProviderFinalizations{
 constructor(attempts,authorizations,results,verify){this.attempts=attempts;this.authorizations=authorizations;this.results=results;this.verify=verify;}
 marker(request,response){return {version:28,kind:'drivekey-provider-finalization-attempt',deviceId:request.deviceId,requestId:request.requestId,fingerprint:request.fingerprint,jobId:request.seed?.job?.response?.jobId,authorizationHash:hash(response)};}
 async existing(wallet,request,response){const saved=await this.results.load(wallet,request.fingerprint.slice(2));if(!saved)return null;if(!isDeepStrictEqual(saved.request,request))throw Error('Finalized proof original request differs.');const checked=await this.verify(request,response,saved.response);if(!isDeepStrictEqual(checked,saved.response))throw Error('Finalized proof verification changed original bytes.');return saved;}
 async assertResolved(wallet){for(const attempt of await this.attempts.list(wallet)){const request=attempt.request,authorization=await this.authorizations.load(wallet,request.fingerprint.slice(2));if(!authorization||!isDeepStrictEqual(authorization.request,request)||!isDeepStrictEqual(attempt.response,this.marker(request,authorization.response))||!await this.existing(wallet,request,authorization.response))throw Error(uncertain);}}
 async claim(wallet,request,response){await this.assertResolved(wallet);const result=await this.attempts.claim(wallet,snapshot(request),this.marker(request,response));if(!result.created)throw Error(uncertain);return result;}
 async retain(wallet,request,response,input){const result=snapshot(input);const saved=await this.results.save(wallet,request,result);const checked=await this.verify(request,response,saved.response);if(!isDeepStrictEqual(checked,saved.response))throw Error('Provider result changed during verification.');return saved;}
}
module.exports={ProviderFinalizations};
