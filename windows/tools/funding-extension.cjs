'use strict';
// Test-only permission gate. No grant is created here; absent approval fails closed.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const FILE='SECOND-ETH-TOPUP-AUTHORIZATION.json';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function verify(grant,manifest,identity,now=Date.now()){
 if(!grant||grant.version!==1||grant.kind!=='bounded-second-eth-topup'||grant.userAnswer!=='Allow one bounded second top-up'||grant.sessionId!==identity.sessionId||grant.sourceFingerprint!==manifest.sourceFingerprint||grant.source!==identity.fundingSource?.evmAddress||grant.destination!==identity.source?.evmAddress||grant.amountWei!=='1000000000000000'||grant.maximumAdditionalGrossUsdMicros!=='2500000'||grant.maximumCombinedFundingUsdMicros!=='10000000'||grant.sessionCeilingUsdMicros!=='29970000'||grant.maximumNewTransfers!==1||grant.otherLimitsUnchanged!==true||grant.allowReplacement!==false||grant.allowRebroadcast!==false||!Number.isSafeInteger(Date.parse(grant.approvedAt))||Date.parse(grant.approvedAt)>now)throw Error('Exact second top-up approval is absent or differs.');
 if(manifest.additionalFundingAuthorization!==FILE||manifest.fundingExtensionGrantSHA256!==digest(grant)||manifest.caseId!=='ethereum-gas-topup-2'||manifest.request?.from!==grant.source||manifest.request?.recipient!==grant.destination||manifest.request?.amount!==grant.amountWei)throw Error('Second top-up manifest differs from its approval.');
 return grant;
}
function readGrant(directory){
 const file=path.join(directory,FILE),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<2||stat.size>65536||fs.realpathSync(file).toLowerCase()!==path.resolve(file).toLowerCase())throw Error('Invalid bounded funding approval file.');
 const fd=fs.openSync(file,'r');let bytes;try{const opened=fs.fstatSync(fd);if(opened.ino!==stat.ino||opened.dev!==stat.dev||opened.nlink!==1||opened.size!==stat.size)throw Error('Funding approval changed while opening.');const buffer=Buffer.alloc(65537),length=fs.readSync(fd,buffer,0,buffer.length,0);if(length!==stat.size)throw Error('Funding approval changed while reading.');bytes=buffer.subarray(0,length);}finally{fs.closeSync(fd);}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function load(directory,manifest,identity){return verify(readGrant(directory),manifest,identity);}
module.exports={FILE,digest,verify,readGrant,load};
