'use strict';

// Evidence audit only. This module grants no signing, retry, funding or submission authority.
const {createHash}=require('node:crypto');
const REQUIRED_CASES=Object.freeze([
 'payment-ethereum-eth','payment-ethereum-usdc','payment-solana-sol','payment-solana-usdc',
 'uniswap-eth-usdc','uniswap-usdc-eth',
 'lifi-ethereum-eth-usdc','lifi-ethereum-usdc-eth','lifi-solana-sol-usdc','lifi-solana-usdc-sol',
 'lifi-bridge-ethereum-solana','lifi-bridge-solana-ethereum',
 'hinkal-ethereum-deposit','hinkal-ethereum-private-payment','hinkal-ethereum-swap','hinkal-ethereum-withdrawal',
 'hinkal-solana-deposit','hinkal-solana-private-payment','hinkal-solana-swap','hinkal-solana-withdrawal',
 'merchant-ethereum-eth','merchant-ethereum-usdc','merchant-solana-sol','merchant-solana-usdc'
]);
const ARTIFACTS=Object.freeze(['windowsExe','windowsAsar','windowsMsix','companionExe','companionAsar','companionZip']);
const REQUIRED_GATES=Object.freeze([
 'localAdversarialIntegration','nativeApprovalAndFileHandoffs','separateDeviceOfflineSigning',
 'isolatedCleanInstall','isolatedUpdateMigration','isolatedBackupRecovery','isolatedUninstall','wack',
 'verifiedCompanyPublisher','identityBoundSignatures','independentSecurityReview','providerSupportAndPins',
 'licensing','publicPrivacySupport','accurateListingAndInstalledScreenshots','ratingsAndMarkets',
 'fundedPublicTestnetWalkthrough','officialSourcePublished','cleanUploadInventory'
]);
const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function releaseDigest(release){
 if(!release||!HASH.test(release.sourceFingerprint)||!release.artifacts)throw Error('Missing exact release identity.');
 const identity={sourceFingerprint:release.sourceFingerprint,artifacts:{}};
 for(const name of ARTIFACTS){const value=release.artifacts[name]?.sha256;if(!HASH.test(value))throw Error('Missing release artifact: '+name);identity.artifacts[name]=value;}
 return sha(JSON.stringify(identity));
}
function auditFullProduct(input){
 const failures=[],rows=[],gates=[];
 const fail=reason=>failures.push(reason);
 if(input?.schemaVersion!==1)fail('Unsupported or missing full-product evidence schema.');
 let digest;try{digest=releaseDigest(input?.release);}catch(error){fail(error.message);}
 const cases=Array.isArray(input?.cases)?input.cases:[];
 const ids=cases.map(row=>row?.id);
 for(const id of new Set(ids)){if(!REQUIRED_CASES.includes(id))fail('Unexpected case: '+String(id));}
 const invoiceClaims=new Set();
 for(const id of REQUIRED_CASES){
  const matches=cases.filter(row=>row?.id===id),reasons=[];
  if(matches.length!==1)reasons.push('Expected exactly one current-release case.');
  const row=matches[0];
  if(row){
   if(!digest||row.releaseDigest!==digest)reasons.push('Evidence belongs to another or incomplete package pair.');
   if(row.status!=='passed'||row.evidenceLevel!=='installed-mainnet')reasons.push('Requires installed-app mainnet qualification.');
   if(row.network!=='mainnet')reasons.push('Wrong evidence network.');
   const steps=['prepared','reviewed','backupVerified','signed','explicitlySubmitted','independentlyConfirmed','canonicalReceipt','restartRecovered'];
   if(!id.startsWith('merchant-'))steps.push('exportImported');
   for(const step of steps)if(row.lifecycle?.[step]!==true)reasons.push('Missing lifecycle step: '+step);
   if(!Array.isArray(row.evidence)||!row.evidence.length||row.evidence.some(e=>!e?.path||!HASH.test(e.sha256)))reasons.push('Missing hash-bound evidence files.');
   if(!Array.isArray(row.transactionHashes)||!row.transactionHashes.length||row.transactionHashes.some(h=>typeof h!=='string'||!(/^(0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})$/).test(h)))reasons.push('Missing canonical transaction identity.');
   if(id.includes('solana-usdc')&&id.startsWith('payment-')&&(row.exactRentVerified!==true||row.recipientTokenAccountCreationVerified!==true))reasons.push('Recipient token-account creation and exact rent are unqualified.');
   if(id.startsWith('lifi-bridge-')&&(row.destinationIndependentlyConfirmed!==true||row.providerStatusUsedAsSettlement!==false))reasons.push('Independent destination settlement is missing.');
   if(id.startsWith('hinkal-')&&(row.genuineProofVerified!==true||row.noteStateIndependentlyVerified!==true))reasons.push('Genuine proof and independent note state are missing.');
   if(id.startsWith('merchant-')){
    if(typeof row.invoiceId!=='string'||!row.invoiceId||row.invoiceCreatedBeforePayment!==true)reasons.push('Missing invoice created before payment.');
    const claim=row.transactionHashes?.[0];
    if(claim&&invoiceClaims.has(claim))reasons.push('The same payment is allocated to two invoices.');
    if(claim)invoiceClaims.add(claim);
   }
  }
  rows.push({id,passed:reasons.length===0,reasons});
 }
 const supplied=Array.isArray(input?.gates)?input.gates:[];
 for(const id of REQUIRED_GATES){
  const matches=supplied.filter(g=>g?.id===id),gate=matches[0],reasons=[];
  if(matches.length!==1)reasons.push('Expected exactly one release gate.');
  if(gate){
   if(gate.status!=='passed'||!digest||gate.releaseDigest!==digest)reasons.push('Gate is incomplete or tied to another release.');
   if(!Array.isArray(gate.evidence)||!gate.evidence.length||gate.evidence.some(e=>!e?.path||!HASH.test(e.sha256)))reasons.push('Missing hash-bound evidence files.');
   if(id==='independentSecurityReview'&&(gate.independent!==true||gate.verdict!=='approved'||typeof gate.reviewer!=='string'||!gate.reviewer.trim()))reasons.push('Missing independent reviewer and approving verdict.');
   if(id==='wack'&&gate.verdict!=='passed')reasons.push('Original WACK verdict must pass.');
  }
  gates.push({id,passed:reasons.length===0,reasons});
 }
 for(const gate of supplied)if(!REQUIRED_GATES.includes(gate?.id))fail('Unexpected gate: '+String(gate?.id));
 const accounting=input?.accounting;
 if(accounting?.ceilingNewUsdMicros!=='29970000'||accounting?.pilotReservedUsdMicros!=='30000'||!HASH.test(accounting?.protectedLedgerSha256))fail('Original spending ceiling and protected ledger identity are required.');
 if(accounting?.unresolvedOperations!==0||accounting?.outstandingPermissions!==0)fail('Unresolved operations or token permissions remain.');
 const amounts=['spentUsdMicros','heldUsdMicros','remainingUsdMicros'];
 if(amounts.some(k=>typeof accounting?.[k]!=='string'||!(/^(0|[1-9][0-9]{0,15})$/).test(accounting[k])))fail('Missing integer gross-debit accounting.');
 else if(BigInt(accounting.spentUsdMicros)+BigInt(accounting.heldUsdMicros)+BigInt(accounting.remainingUsdMicros)!==29970000n)fail('Gross debits and reservations do not reconcile to the original ceiling.');
 const passed=failures.length===0&&rows.every(r=>r.passed)&&gates.every(g=>g.passed);
 return {schemaVersion:1,scope:'Hash-bound evidence completeness audit; supporting assertions still require independent verification.',releaseDigest:digest??null,requiredCases:REQUIRED_CASES.length,passedCases:rows.filter(r=>r.passed).length,cases:rows,gates,failures,evidenceComplete:passed,submissionReady:false,signingAuthorizationIssued:false};
}
module.exports={REQUIRED_CASES,REQUIRED_GATES,ARTIFACTS,releaseDigest,auditFullProduct};
