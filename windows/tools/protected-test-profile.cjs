'use strict';
// Only errors constructed from fixed local messages may cross this boundary.
class ProfileError extends Error {}
function safeProfileFailure(error){return error instanceof ProfileError?error.message:'Isolated test profile rejected the operation. No secret values were logged.';}
const {verifyHinkalSolanaSwapResponse}=require('../dist/hinkal-solana-swap.cjs');
// Fresh offline process. No networking imports or secret-bearing command arguments.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomBytes,randomUUID}=require('node:crypto');
const {authorizePayment,authorizeFunding,authorizeOperation,cost,digest}=require('./acceptance-policy.cjs');
const {validatePayment,verifyPaymentResponse,CHAINS}=require('../dist/payment.cjs');
const {validateSwap,verifySwapResponse,UNISWAP_V3}=require('../dist/swap.cjs');
const {validateHinkal,verifyHinkalResponse,HINKAL_PIN}=require('../dist/hinkal.cjs');
const {validateLifiEvm,verifyLifiEvmResponse,LIFI_EVM}=require('../dist/lifi-evm.cjs');
const {validateLifiSolana,verifyLifiSolanaResponse}=require('../dist/lifi-solana.cjs');
const proofCore=require('../dist/hinkal-proof-link.cjs'),{authorizeHinkalProof,authorizeHinkalChain,authorizeProoflessHinkal}=require('./hinkal-acceptance-policy.cjs'),{HINKAL_NATIVE_SWAP}=require('../dist/hinkal-evm-swap-proof.cjs'),{verifyHinkalEvmSwapResponse}=require('../dist/hinkal-evm-swap.cjs'),{verifyHinkalSolanaSpendResponse}=require('../dist/hinkal-solana-spend.cjs'),{validateHinkalSolana,verifyHinkalSolanaResponse,HINKAL_SOLANA}=require('../dist/hinkal-solana.cjs');
const validators={...proofCore,validateHinkalSolana,validateLifiSolana,validateLifiEvm,validateSwap,validateHinkal,solanaLifiProgram:'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',lifiRouter:LIFI_EVM.diamond.address,uniswapRouter:UNISWAP_V3.router,hinkalContract:HINKAL_PIN.ethereumContract,hinkalSolanaProgram:HINKAL_SOLANA.program,hinkalSwapExternal:HINKAL_NATIVE_SWAP.external.address};
const relayCore=require('../dist/lifi-relay.cjs'),{RELAY}=require('../dist/relay-order.cjs'),{authorizeRelaySource}=require('./relay-acceptance-policy.cjs');
const {bridgeCodec}=require('./bridge-intent-codecs.cjs');
const {bridgeProfileActions,handleBridgeAction}=require('./bridge-profile-actions.cjs');
validators.validateLifiRelay=relayCore.validateLifiRelay;validators.lifiRelayDiamond=LIFI_EVM.diamond.address;validators.relaySolanaProgram=RELAY.solanaDepository;
const verifySigned=(s,r,w,expiry=true)=>(bridgeCodec(r)?.verify|| (r.version===21?verifyHinkalSolanaSwapResponse:r.version===18?verifyHinkalEvmSwapResponse:r.version===16?verifyHinkalSolanaSpendResponse:r.version===14?verifyHinkalSolanaResponse:r.version===11?verifyLifiSolanaResponse:r.version===12?verifyLifiEvmResponse:r.version===10?verifyHinkalResponse:r.version===9?verifySwapResponse:verifyPaymentResponse))(s,r,w,Date.now(),expiry);
const root=path.resolve(__dirname,'..');
const {qualifiedRelease}=require('./qualified-release.cjs');
function dpapi(mode,data){
 const method=mode==='protect'?'Protect':'Unprotect';
 const code=`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());try{$o=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($o))}finally{[Array]::Clear($b,0,$b.Length);if($o){[Array]::Clear($o,0,$o.Length)}}`;
 const p=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input:Buffer.from(data).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
 if(p.status!==0)throw new ProfileError('Local Windows DPAPI operation failed.');return Buffer.from(p.stdout.trim(),'base64');
}
function worker(job,file='worker.cjs',packaged=false,executionFile,executionReceipt){
 if(packaged&&(file!=='worker.cjs'||job.action!=='sign'||!executionFile||!executionReceipt))throw new ProfileError('Only chain signing uses the packaged transport with execution evidence.');
 if(!['worker.cjs','hinkal-login.cjs','hinkal-proof-sign.cjs','hinkal-solana-proof-sign.cjs','hinkal-local-swap.cjs','hinkal-local-solana-swap-worker.cjs','cctp-auxiliary.cjs'].includes(file))throw new ProfileError('Unknown isolated signing worker.');
 const transport=packaged?require('./packaged-test-worker.cjs').packagedTestWorker(root):{node:process.execPath,worker:path.join(root,'dist',file)};
 const execution=packaged?{version:1,...transport.evidence,requestFingerprint:job.fingerprint,startedAt:new Date().toISOString(),state:'starting'}:undefined;
 if(execution)write(executionFile,JSON.stringify(execution));
 const p=spawnSync(transport.node,['--no-addons','--require',path.join(root,'tools/test-signing-network-deny.cjs'),transport.worker],{input:JSON.stringify(job),encoding:'utf8',env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP},windowsHide:true,timeout:90000,maxBuffer:2*1024*1024});
 if(execution){
  Object.assign(execution,{state:'exited',completedAt:new Date().toISOString(),pid:p.pid,exitCode:p.status,signal:p.signal||null,spawnFailed:Boolean(p.error)});
  Object.assign(executionReceipt,execution);
 }
 let r;try{r=JSON.parse(p.stdout);}catch{throw new ProfileError('Isolated signer failed.');}
 if(p.status||!r.ok)throw new ProfileError('Isolated signer rejected request.');
 return r.result;
}
function write(file,data){const tmp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function persistSignedResponse(base,response,execution){
 write(base+'.response.dpapi',dpapi('protect',Buffer.from(JSON.stringify(response))));
 if(execution.state)write(base+'.execution.json',JSON.stringify(execution));
}
function json(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function directory(session){if(!/^[0-9a-f-]{36}$/.test(session))throw new ProfileError('Invalid session.');return path.join(process.env.LOCALAPPDATA,'DriveKeyAcceptance',session);}
const {profileLock:lock}=require('./profile-lock.cjs');
function protectedView(dir,identity,chain,role='source'){
 const filename=path.join(dir,role+'-hinkal-view-'+chain+'.dpapi');if(fs.existsSync(filename)){const plain=dpapi('unprotect',fs.readFileSync(filename));try{return JSON.parse(plain);}finally{plain.fill(0);}}
 const address=chain==='ethereum'?identity[role].evmAddress:identity[role].solanaAddress,key=dpapi('unprotect',fs.readFileSync(path.join(dir,role+'.unlock.dpapi')));let view;try{view=worker({action:'derive-test-hinkal-view',testOnly:true,chain,expectedAddress:address,vault:json(path.join(dir,role+'.vault.json')),password:key.toString('utf8')},'hinkal-login.cjs');}finally{key.fill(0);}write(filename,dpapi('protect',Buffer.from(JSON.stringify(view))));return view;
}
async function qualifiedManifest(manifest,identity){const release=await qualifiedRelease(root);if(release.source.fingerprint!==identity.sourceFingerprint||manifest?.sourceFingerprint!==release.source.fingerprint)throw new ProfileError('Proof source changed; requalification or recovery is required.');if(!manifest.binaryHashes||Object.keys(manifest.binaryHashes).length<4||Object.entries(manifest.binaryHashes).some(([name,hash])=>release.build.binaryHashes[name]!==hash))throw new ProfileError('Proof manifest binaries differ from the qualified release.');return release;}
function proofRecord(dir,state,fingerprint){const op=state.operations.find(o=>o.proofFingerprint===fingerprint||o.fingerprint===fingerprint||o.chainFingerprint===fingerprint);if(!op?.proofFingerprint)throw new ProfileError('No durable private proof reservation.');const base=path.join(dir,op.proofFingerprint.slice(2)),manifest=json(base+'.proof-manifest.json');if(digest(manifest)!==op.proofManifestHash)throw new ProfileError('Private proof authorization manifest changed.');const plain=dpapi('unprotect',fs.readFileSync(base+'.proof-response.dpapi'));let authorization;try{authorization=JSON.parse(plain);}finally{plain.fill(0);}return {op,base,manifest,authorization};}
function assertEvidenceClass(manifest,identity){if([manifest?.fixtureOnly,manifest?.valuation?.synthetic,manifest?.preflight?.synthetic,manifest?.simulation?.synthetic].some(v=>v!==undefined&&typeof v!=='boolean'))throw new ProfileError('Evidence classification flags must be explicit Booleans.');const synthetic=manifest?.fixtureOnly===true||manifest?.valuation?.synthetic===true||manifest?.preflight?.synthetic===true||manifest?.simulation?.synthetic===true;if(identity.fixtureOnly===true?manifest?.fixtureOnly!==true:synthetic)throw new ProfileError('Synthetic preconditions are restricted to isolated fixture profiles and cannot authorize funded-session signing.');}
function assertRequalificationSafe(state){if(!Array.isArray(state.operations)||state.permissions?.length||state.operations.some(o=>!['settled','cancelled-before-signing'].includes(o.state)||o.state==='settled'&&(!/^0x[0-9a-f]{64}$/.test(o.transactionHash||'')&&!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(o.transactionHash||'')||!/^(0|[1-9][0-9]*)$/.test(o.actualUsdMicros||''))||o.state==='cancelled-before-signing'&&(o.transactionHash||o.proofResponseHash&&!require('./local-proof-recovery.cjs').isSafelyCancelledLocalProof(o))))throw new ProfileError('Resolve every operation and token permission before qualifying changed source.');}
const {authorizeRecipientReturn}=require('./recipient-return-policy.cjs');
function signingRole(m){if(m.kind==='disposable-payment-authorization'&&m.signingRole==='recipient'&&m.purpose==='return-test-funding'&&m.request?.version===8&&m.request.chain==='solana'&&m.request.asset==='SOL')return 'recipient';if(m.kind==='disposable-funding-authorization')return 'funding';if(m.signingRole===undefined||m.signingRole==='source')return 'source';if(m.kind==='disposable-relay-source-authorization'&&m.signingRole==='funding'&&m.request?.version===26)return 'funding';throw new ProfileError('Unknown protected signing role.');}
function fundingHistory(dir,state){
 let total=0n,additionalFundingTransfers=0;
 for(const op of state.operations){
  if(op.state==='cancelled-before-signing')continue;
  const fp=op.chainFingerprint||op.fingerprint,file=path.join(dir,fp.slice(2)+'.manifest.json');
  if(!fs.existsSync(file))throw new ProfileError('Missing prior authorization manifest; funding total cannot be verified.');
  const m=json(file);
  if(digest(m)!==(op.chainManifestHash||op.manifestHash))throw new ProfileError('Prior authorization manifest changed.');
  if(signingRole(m)==='funding'){
   total+=BigInt(op.state==='settled'?op.actualUsdMicros:op.reservedUsdMicros);
   if(m.additionalFundingAuthorization!==undefined){
    if(m.kind!=='disposable-funding-authorization'||!['ETHEREUM-TOPUP-AUTHORIZATION.json','SECOND-ETH-TOPUP-AUTHORIZATION.json'].includes(m.additionalFundingAuthorization))throw new ProfileError('Unknown historical funding authorization.');
    if(m.additionalFundingAuthorization==='SECOND-ETH-TOPUP-AUTHORIZATION.json')require('./funding-extension.cjs').load(dir,m,json(path.join(dir,'public.json')));
    additionalFundingTransfers++;
   }
  }
 }
 return {fundingCommittedUsdMicros:total.toString(),additionalFundingTransfers};
}
async function main(job){
 if(process.platform!=='win32')throw new ProfileError('Windows DPAPI profile required.');
 if(job.action==='provision'){
  if(job.fixtureOnly!==undefined&&typeof job.fixtureOnly!=='boolean')throw new ProfileError('Explicit Boolean fixture classification required.');
  const {fingerprint}=await import('./fingerprint.mjs'),source=await fingerprint(root),sessionId=randomUUID(),dir=directory(sessionId);fs.mkdirSync(dir,{recursive:true});
  const who=spawnSync('whoami.exe',[],{encoding:'utf8',windowsHide:true});if(who.status!==0)throw new ProfileError('Cannot determine local account.');
  const acl=spawnSync('icacls.exe',[dir,'/inheritance:r','/grant:r',who.stdout.trim()+':(OI)(CI)F'],{encoding:'utf8',windowsHide:true});if(acl.status!==0)throw new ProfileError('Cannot restrict credential files.');
  const identities={};
  for(const role of ['source','recipient']){const password=randomBytes(48).toString('base64'),vault=worker({action:'create',password});write(path.join(dir,role+'.vault.json'),JSON.stringify(vault));write(path.join(dir,role+'.unlock.dpapi'),dpapi('protect',Buffer.from(password)));identities[role]=vault.public;}
  const publicData={version:1,sessionId,sourceFingerprint:source.fingerprint,...identities,usdc:{ethereum:CHAINS.ethereum.usdc,solana:CHAINS.solana.usdc},credentialProtection:'Windows DPAPI CurrentUser; inherited ACL removed; current user only',testOnly:true,fixtureOnly:job.fixtureOnly===true};
  write(path.join(dir,'public.json'),JSON.stringify(publicData));write(path.join(dir,'ledger.json'),JSON.stringify({version:1,sessionId,sourceFingerprint:source.fingerprint,pilotReservedUsdMicros:'30000',ceilingNewUsdMicros:'29970000',operations:[]}));return publicData;
 }
 const dir=directory(job.sessionId),identity=json(path.join(dir,'public.json'));
 if(identity.fixtureOnly!==true&&['sign-hinkal-chain','sign-payment','sign-funding','sign-swap','sign-hinkal','sign-relay-source','sign-mayan-source','sign-mayan-destination'].includes(job.action))require('./packaged-test-worker.cjs').packagedTestWorker(root);
 if(job.manifest)assertEvidenceClass(job.manifest,identity);
 if(job.action==='take-submission'&&identity.fixtureOnly===true||job.action==='take-fixture-submission'&&identity.fixtureOnly!==true)throw new ProfileError('A fixture submission gate cannot authorize network broadcasting.');
 if(bridgeProfileActions.has(job.action))return handleBridgeAction(job,{dir,identity,lock,json,write,dpapi,worker,verifySigned,persistSignedResponse,qualifiedManifest,assertEvidenceClass});
 if(job.action==='derive-cctp-auxiliary-public'){
  const release=await lock(dir);try{const qualified=await qualifiedRelease(root);if(qualified.source.fingerprint!==identity.sourceFingerprint)throw new ProfileError('Auxiliary public derivation requires the qualified source.');if(!/^[0-9a-f-]{36}$/.test(job.requestId||''))throw new ProfileError('A new bridge request UUID is required.');const key=dpapi('unprotect',fs.readFileSync(path.join(dir,'source.unlock.dpapi')));try{return worker({action:'derive-public',testOnly:true,vault:json(path.join(dir,'source.vault.json')),password:key.toString('utf8'),scope:{requestId:job.requestId,deviceId:identity.source.deviceId,from:identity.source.solanaAddress}},'cctp-auxiliary.cjs');}finally{key.fill(0);}}finally{await release();}
 }
 if(job.action==='status')return {identity,ledger:json(path.join(dir,'ledger.json'))};
 if(job.action==='hinkal-identity')throw new ProfileError('A full shielded spending capability cannot be exported to provider planning. Use a read-only view and isolated proof authorization.');
 if(job.action==='inspect-hinkal-inputs'){
  const release=await lock(dir);try{const seed=proofCore.validateHinkalAcceptanceSeed(job.seed);if(seed.deviceId!==identity.source.deviceId)throw new ProfileError('Private inputs belong to another protected test wallet.');return await proofCore.inspectHinkalAcceptanceInputs(seed,protectedView(dir,identity,seed.job.context.chain));}finally{await release();}
 }
 if(job.action==='sign-hinkal-proof'){
  await qualifiedManifest(job.manifest,identity);const release=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),seed=proofCore.validateHinkalAcceptanceSeed(job.manifest.seed),view=protectedView(dir,identity,seed.job.context.chain),inputs=await proofCore.inspectHinkalAcceptanceInputs(seed,view),op=authorizeHinkalProof(job.manifest,state,identity,validators,Date.now(),inputs),base=path.join(dir,op.proofFingerprint.slice(2));write(base+'.proof-manifest.json',JSON.stringify(job.manifest));state.operations.push(op);write(path.join(dir,'ledger.json'),JSON.stringify(state));
   // Reserve the independently decrypted gross inputs and fsync before generating R8/S.
   const key=dpapi('unprotect',fs.readFileSync(path.join(dir,'source.unlock.dpapi')));let authorization;try{authorization=worker({action:[19,20,27].includes(seed.version)?'sign-local-swap':'sign-proof-job',testOnly:true,vault:json(path.join(dir,'source.vault.json')),password:key.toString('utf8'),seed,fingerprint:seed.fingerprint},[20,27].includes(seed.version)?'hinkal-local-solana-swap-worker.cjs':seed.version===19?'hinkal-local-swap.cjs':seed.version===15?'hinkal-solana-proof-sign.cjs':'hinkal-proof-sign.cjs');}finally{key.fill(0);}await proofCore.verifyHinkalProofAuthorization(seed,authorization,view.spendingPublicKey,Date.now(),false);write(base+'.proof-response.dpapi',dpapi('protect',Buffer.from(JSON.stringify(authorization))));op.state='proof-signed';op.proofResponseHash=digest(authorization);write(path.join(dir,'ledger.json'),JSON.stringify(state));if(Date.now()>=Date.parse(seed.expiresAt))throw new ProfileError('Proof authorization expired after signing; durable response retained for recovery only.');return {authorization,reservedUsdMicros:op.reservedUsdMicros,proofResponsePersisted:true};
  }finally{await release();}
 }
 if(job.action==='recover-proof-authorization'||job.action==='prove-local-hinkal-swap'){
  const release=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),record=proofRecord(dir,state,job.fingerprint),{op,base,manifest,authorization}=record,seed=manifest.seed,view=protectedView(dir,identity,seed.job.context.chain);await proofCore.verifyHinkalProofAuthorization(seed,authorization,view.spendingPublicKey,Date.now(),job.action!=='recover-proof-authorization');if(op.proofResponseHash&&op.proofResponseHash!==digest(authorization))throw new ProfileError('Private proof response differs from its durable hash.');if(op.state==='proof-reserved'){op.state='proof-signed';op.proofResponseHash=digest(authorization);op.recoveredProofAt=new Date().toISOString();write(path.join(dir,'ledger.json'),JSON.stringify(state));}
   if(job.action==='recover-proof-authorization')return {manifest,authorization,operation:op};await qualifiedManifest(manifest,identity);if(![19,20,27].includes(seed.version)||op.state!=='proof-signed')throw new ProfileError('Only the unresolved locally authorized swap may be proved.');const file=base+'.proof-output.dpapi';if(fs.existsSync(file)){const plain=dpapi('unprotect',fs.readFileSync(file));try{return JSON.parse(plain);}finally{plain.fill(0);}}const proof=worker({action:'prove-local-swap',testOnly:true,input:{seed,authorization,view,artifactDirectory:path.resolve(root,'../proof-artifacts/hinkal-v4')}},[20,27].includes(seed.version)?'hinkal-local-solana-swap-worker.cjs':'hinkal-local-swap.cjs');write(file,dpapi('protect',Buffer.from(JSON.stringify(proof))));return proof;
  }finally{await release();}
 }
 if(job.action==='cancel-expired-local-proof'){
  const release=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),record=proofRecord(dir,state,job.fingerprint),{op,base,manifest,authorization}=record;if(fs.existsSync(base+'.response.dpapi')||fs.existsSync(base+'.manifest.json'))throw new ProfileError('Possible chain signature artifact; cancellation forbidden.');const view=protectedView(dir,identity,'solana');await proofCore.verifyHinkalProofAuthorization(manifest.seed,authorization,view.spendingPublicKey,Date.now(),false);const cancellation=require('./local-proof-recovery.cjs').authorizeLocalProofCancellation(op,manifest,job.observations,identity);Object.assign(op,cancellation);write(path.join(dir,'ledger.json'),JSON.stringify(state));return op;}finally{await release();}
 }
 if(job.action==='sign-hinkal-chain'){
  await qualifiedManifest(job.manifest,identity);const release=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),{op,manifest,authorization}=proofRecord(dir,state,job.manifest.proofFingerprint),view=protectedView(dir,identity,manifest.seed.job.context.chain),inputs=await proofCore.inspectHinkalAcceptanceInputs(manifest.seed,view),link=await authorizeHinkalChain(job.manifest,manifest,authorization,op,state,identity,validators,view.spendingPublicKey,Date.now(),inputs),r=link.request,base=path.join(dir,r.fingerprint.slice(2));
   // The same operation owns the original reservation throughout both phases.
   // A crash here never permits another proof, chain signature or reservation.
   write(base+'.manifest.json',JSON.stringify(job.manifest));op.state='chain-signing';op.chainFingerprint=r.fingerprint;op.chainManifestHash=link.chainManifestHash;write(path.join(dir,'ledger.json'),JSON.stringify(state));const key=dpapi('unprotect',fs.readFileSync(path.join(dir,'source.unlock.dpapi')));let response,execution={};try{response=worker({action:'sign',vault:json(path.join(dir,'source.vault.json')),password:key.toString('utf8'),request:r,fingerprint:r.fingerprint},'worker.cjs',identity.fixtureOnly!==true,base+'.execution.json',execution);}finally{key.fill(0);}verifySigned(response,r,identity.source,false);persistSignedResponse(base,response,execution);op.state='signed';op.fingerprint=r.fingerprint;op.manifestHash=op.chainManifestHash;op.transactionHash=response.transactionHash;write(path.join(dir,'ledger.json'),JSON.stringify(state));return {transactionHash:response.transactionHash,fingerprint:r.fingerprint,reservedUsdMicros:op.reservedUsdMicros,responsePersisted:true,proofFingerprint:op.proofFingerprint};
  }finally{await release();}
 }
 if(job.action==='hinkal-view'){
  if(!['ethereum','solana'].includes(job.chain)||!['source','recipient'].includes(job.role))throw new ProfileError('Unsupported test Hinkal identity scope.');
  const unlock=await lock(dir);try{const role=job.role,filename=path.join(dir,role+'-hinkal-view-'+job.chain+'.dpapi'),vault=json(path.join(dir,role+'.vault.json')),address=job.chain==='ethereum'?vault.public.evmAddress:vault.public.solanaAddress;
   if(fs.existsSync(filename)){const b=dpapi('unprotect',fs.readFileSync(filename));try{return JSON.parse(b);}finally{b.fill(0);}}
   const manifest={version:1,kind:'test-only-hinkal-identity-derivation',sessionId:job.sessionId,role,chain:job.chain,address,message:'Sign to deterministically derive your Hinkal shielded account keys.',scope:'Local deterministic shielded-key derivation only; no chain transaction or relay is authorized',createdAt:new Date().toISOString()};write(filename+'.manifest.json',JSON.stringify(manifest));
   const key=dpapi('unprotect',fs.readFileSync(path.join(dir,role+'.unlock.dpapi')));let result;try{result=worker({action:'derive-test-hinkal-view',testOnly:true,chain:job.chain,expectedAddress:address,vault,password:key.toString('utf8')},'hinkal-login.cjs');}finally{key.fill(0);}
   write(filename,dpapi('protect',Buffer.from(JSON.stringify(result))));return result;
  }finally{await unlock();}
 }
 if(job.action==='provision-token-recipient'){
  const unlock=await lock(dir);try{if(identity.tokenRecipient)throw new ProfileError('Token recipient already exists.');const password=randomBytes(48).toString('base64'),vault=worker({action:'create',password});write(path.join(dir,'token-recipient.vault.json'),JSON.stringify(vault));write(path.join(dir,'token-recipient.unlock.dpapi'),dpapi('protect',Buffer.from(password)));identity.tokenRecipient=vault.public;write(path.join(dir,'public.json'),JSON.stringify(identity));return identity;}finally{await unlock();}
 }
 if(job.action==='verify-protection'){
  for(const role of ['source','recipient']){const secret=dpapi('unprotect',fs.readFileSync(path.join(dir,role+'.unlock.dpapi')));try{const result=worker({action:'verify',vault:json(path.join(dir,role+'.vault.json')),password:secret.toString('utf8')});if(!result.verified||result.public.deviceId!==identity[role].deviceId)throw new ProfileError('Protected wallet verification failed.');}finally{secret.fill(0);}}
  return {verified:true,sessionId:job.sessionId,roles:['source','recipient'],mechanism:'DPAPI CurrentUser -> isolated existing signing worker',signedTransactions:0};
 }
 if(job.action==='qualify-source'){
  const unlock=await lock(dir);try{
   const state=json(path.join(dir,'ledger.json'));assertRequalificationSafe(state);
   const {source,checks:checked}=await qualifiedRelease(root);
   if(state.sourceFingerprint!==source.fingerprint){state.qualificationHistory||=[];state.qualificationHistory.push({previousSourceFingerprint:state.sourceFingerprint,sourceFingerprint:source.fingerprint,qualifiedAt:new Date().toISOString(),retainedOperations:state.operations.length,retainedActualUsdMicros:state.operations.filter(o=>o.state==='settled').reduce((n,o)=>n+BigInt(o.actualUsdMicros),0n).toString()});}state.sourceFingerprint=source.fingerprint;identity.sourceFingerprint=source.fingerprint;write(path.join(dir,'ledger.json'),JSON.stringify(state));write(path.join(dir,'public.json'),JSON.stringify(identity));return {identity,qualification:checked};
  }finally{await unlock();}
 }
 if(['recovery-record','take-submission','take-fixture-submission'].includes(job.action)){
  const unlock=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),operation=state.operations.find(o=>o.fingerprint===job.fingerprint||o.chainFingerprint===job.fingerprint||o.proofFingerprint===job.fingerprint);if(!operation)throw new ProfileError('No durable operation reservation.');
   const chainFingerprint=operation.chainFingerprint||operation.fingerprint,base=path.join(dir,chainFingerprint.slice(2)),manifest=json(base+'.manifest.json');if(digest(manifest)!==(operation.chainManifestHash||operation.manifestHash))throw new ProfileError('Authorization manifest changed.');
   const plain=dpapi('unprotect',fs.readFileSync(base+'.response.dpapi'));let response;try{response=JSON.parse(plain);}finally{plain.fill(0);}
   const w=(signingRole(manifest)==='recipient'?identity.recipient:signingRole(manifest)==='funding'?identity.fundingSource:identity.source);verifySigned(response,manifest.request,w,job.action!=='recovery-record');if(operation.transactionHash&&operation.transactionHash!==response.transactionHash)throw new ProfileError('Durable signed hash differs from ledger.');if(['reserved','chain-signing'].includes(operation.state)){if(operation.transactionHash||operation.broadcastAttempts)throw new ProfileError('Ambiguous reserved operation; reconcile without signing.');operation.state='signed';operation.fingerprint=chainFingerprint;operation.manifestHash=operation.chainManifestHash||operation.manifestHash;operation.transactionHash=response.transactionHash;operation.recoveredDurableResponseAt=new Date().toISOString();write(path.join(dir,'ledger.json'),JSON.stringify(state));}else if(!operation.transactionHash)throw new ProfileError('Missing signed ledger hash; reservation retained.');
   if(job.action!=='recovery-record'){assertEvidenceClass(manifest,identity);const release=await qualifiedRelease(root);if(release.source.fingerprint!==manifest.sourceFingerprint)throw new ProfileError('Signed release changed. Reconcile only.');if(operation.state!=='signed')throw new ProfileError('One-time submission gate consumed. Reconcile only.');operation.state=identity.fixtureOnly?'fixture-gate-consumed':'submitting';if(identity.fixtureOnly)operation.fixtureSubmissionAttempts=1;else operation.broadcastAttempts=1;operation.submittingAt=new Date().toISOString();write(path.join(dir,'ledger.json'),JSON.stringify(state));}
   return {manifest,request:manifest.request,response,operation,networkBroadcastAllowed:identity.fixtureOnly!==true};
  }finally{await unlock();}
 }
 if(['record-relay-source','record-relay-route'].includes(job.action)){
  const unlock=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),op=state.operations.find(o=>o.fingerprint===job.fingerprint);if(op?.kind!=='relay-bridge'||!['submitting','pending','uncertain','fixture-gate-consumed','relay-destination-pending','settled'].includes(op.state))throw new ProfileError('No submitted Relay parent reservation.');
   assertEvidenceClass({fixtureOnly:job.fixtureOnly,preflight:{synthetic:job.synthetic}},identity);
   const base=path.join(dir,op.fingerprint.slice(2)),manifest=json(base+'.manifest.json');if(digest(manifest)!==op.manifestHash)throw new ProfileError('Relay authorization manifest changed.');const plain=dpapi('unprotect',fs.readFileSync(base+'.response.dpapi'));let response;try{response=JSON.parse(plain);}finally{plain.fill(0);}verifySigned(response,manifest.request,(signingRole(manifest)==='recipient'?identity.recipient:signingRole(manifest)==='funding'?identity.fundingSource:identity.source),false);if(response.transactionHash!==op.transactionHash)throw new ProfileError('Relay durable source hash differs.');
   const c=require('./relay-settlement-cost.cjs'),actual=job.action==='record-relay-source'?c.relaySourceCost(manifest.request,response,job.observations,manifest.valuation):c.relayRouteCost(manifest.request,response,job.observations,manifest.valuation);if(BigInt(actual.actualSourceUsdMicros)>BigInt(op.reservedUsdMicros)||op.sourceProofHash&&op.sourceProofHash!==actual.sourceProofHash)throw new ProfileError('Relay debit exceeded reservation or prior source proof changed.');
   if(job.action==='record-relay-source'){Object.assign(op,c.holdRelaySource(op,actual),{sourceFinality:job.observations,sourceConfirmedAt:new Date().toISOString()});}
   else{if(op.state==='settled'&&(op.actualUsdMicros!==actual.actualUsdMicros||op.destinationTransactionHash!==actual.destinationTransactionHash))throw new ProfileError('Previously settled Relay route changed.');Object.assign(op,actual,{state:'settled',finality:job.observations,recoveredInSeparateProcess:true,settledAt:new Date().toISOString()});}
   write(path.join(dir,'ledger.json'),JSON.stringify(state));return op;
  }finally{await unlock();}
 }
 if(job.action==='record-settlement'){
  const unlock=await lock(dir);try{const state=json(path.join(dir,'ledger.json')),op=state.operations.find(o=>o.fingerprint===job.fingerprint||o.chainFingerprint===job.fingerprint);if(!op||!['submitting','pending','uncertain','settled'].includes(op.state))throw new ProfileError('No submitted operation to reconcile.');if(['relay-bridge','bridge'].includes(op.kind))throw new ProfileError('A bridge parent requires independent complete-route settlement; generic source settlement cannot release its reservation.');
   if(!Array.isArray(job.observations)||job.observations.length!==2||!require('./independent-sources.cjs').independent(job.observations.map(o=>o.endpoint))||job.observations.some(o=>o.state!=='confirmed'||o.transactionHash!==op.transactionHash||!o.receipt))throw new ProfileError('Two independent finalized receipts required.');
   const [a,b]=job.observations;
   const manifest=json(path.join(dir,op.fingerprint.slice(2)+'.manifest.json'));if(digest(manifest)!==op.manifestHash)throw new ProfileError('Manifest changed.');
   const r=manifest.request;if(r.network==='solana'){
    const plain=dpapi('unprotect',fs.readFileSync(path.join(dir,op.fingerprint.slice(2)+'.response.dpapi')));let response;try{response=JSON.parse(plain);}finally{plain.fill(0);}
    const actual=[14,16,21].includes(r.version)?await require('./hinkal-solana-cost.cjs').hinkalSolanaCost(r,response,job.observations,manifest.valuation,op.grossInputBaseUnits):r.version===11?require('./solana-swap-cost.cjs').solanaSwapCost(r,response,job.observations,manifest.valuation):require('./solana-settlement-cost.cjs').solanaSettlementCost(r,response,job.observations,manifest.valuation);if(BigInt(actual.actualUsdMicros)>BigInt(op.reservedUsdMicros))throw new ProfileError('Actual Solana debit exceeds reservation.');Object.assign(op,actual,{state:'settled',finality:job.observations,recoveredInSeparateProcess:true,settledAt:new Date().toISOString()});write(path.join(dir,'ledger.json'),JSON.stringify(state));return op;
   }
   if(job.observations.some(o=>o.receipt.transactionHash!==op.transactionHash)||a.receipt.blockHash!==b.receipt.blockHash||a.receipt.gasUsed!==b.receipt.gasUsed||a.receipt.effectiveGasPrice!==b.receipt.effectiveGasPrice)throw new ProfileError('Independent Ethereum settlement disagreement.');
   const {Transaction,getAddress}=require('ethers'),unsigned=Transaction.from(r.unsignedTransaction);if(job.observations.some(o=>o.receipt.status!=='0x1'||getAddress(o.receipt.from)!==getAddress(r.from)||getAddress(o.receipt.to)!==unsigned.to))throw new ProfileError('Receipt sender, target or status mismatch.');
   const actualFee=BigInt(a.receipt.gasUsed)*BigInt(a.receipt.effectiveGasPrice);if(actualFee>BigInt(r.maximumFee))throw new ProfileError('Actual fee exceeds signed maximum.');
   const approval=['approve','revoke','hinkal-approve','hinkal-revoke'].includes(r.action),asset=r.asset||r.tokenIn;
   const assetPrice=op.kind==='bridge-allowance'?manifest.valuation.usdcUsdMicros:manifest.valuation.assetUsdMicros,nativePrice=op.kind==='bridge-allowance'?manifest.valuation.ethereumUsdMicros:manifest.valuation.nativeUsdMicros;
   const actual=(approval?0n:cost(op.grossInputBaseUnits||r.amount,assetPrice,asset==='USDC'?6:18))+cost(actualFee.toString(),nativePrice,18);
   if(actual>BigInt(op.reservedUsdMicros))throw new ProfileError('Actual debit exceeds reservation.');
   if(op.state==='settled'){
    const previous=op.finality;
    if(op.actualUsdMicros!==actual.toString()||op.actualFeeBaseUnits!==actualFee.toString()||!Array.isArray(previous)||previous.length!==2||previous.some(o=>o.state!=='confirmed'||o.transactionHash!==op.transactionHash||o.receipt?.transactionHash!==op.transactionHash||o.receipt.status!=='0x1'||o.receipt.blockHash!==a.receipt.blockHash||o.receipt.gasUsed!==a.receipt.gasUsed||o.receipt.effectiveGasPrice!==a.receipt.effectiveGasPrice))throw new ProfileError('Previously settled Ethereum evidence changed.');
    if(op.permission&&[...previous,...job.observations].some(o=>o.allowance!==r.amount)||!op.permission&&asset==='USDC'&&r.action==='swap'&&[...previous,...job.observations].some(o=>o.allowance!=='0'))throw new ProfileError('Previously settled allowance evidence changed.');
    return op;
   }
   state.permissions||=[];if(op.permission){if(job.observations.some(o=>o.allowance!==r.amount))throw new ProfileError('Independent exact allowance settlement required.');state.permissions=state.permissions.filter(p=>p.spender.toLowerCase()!==op.permission.spender.toLowerCase());if(!op.permission.revocation)state.permissions.push({routeId:op.routeId,spender:op.permission.spender,amount:r.amount,approvalHash:op.transactionHash});}
   else if(asset==='USDC'&&state.permissions.length){if(job.observations.some(o=>o.allowance!=='0'))throw new ProfileError('Bounded token permission was not independently consumed.');state.permissions=state.permissions.filter(p=>p.routeId!==op.routeId);}
   op.state='settled';op.actualFeeBaseUnits=actualFee.toString();op.actualUsdMicros=actual.toString();op.finality=job.observations;op.recoveredInSeparateProcess=true;op.settledAt=new Date().toISOString();write(path.join(dir,'ledger.json'),JSON.stringify(state));return op;
  }finally{await unlock();}
 }
 if(['sign-payment','sign-funding','sign-swap','sign-hinkal','sign-relay-source'].includes(job.action)){
  const {source:release,build}=await qualifiedRelease(root);if(release.fingerprint!==identity.sourceFingerprint)throw new ProfileError('Source changed after test profile provisioning. Requalification required.');
  if(!job.manifest?.binaryHashes||Object.keys(job.manifest.binaryHashes).length<4||Object.entries(job.manifest.binaryHashes).some(([name,hash])=>build.binaryHashes[name]!==hash))throw new ProfileError('Public manifest binary hashes differ from the qualified build.');
  const unlock=await lock(dir);try{
   if(job.action==='sign-hinkal'&&job.manifest.request.version!==14&&!['hinkal-approve','hinkal-revoke'].includes(job.manifest.request.action))throw new ProfileError('Private proof actions require the proof reservation and chain signing phases.');
   if(job.action==='sign-funding'&&job.manifest.additionalFundingAuthorization==='SECOND-ETH-TOPUP-AUTHORIZATION.json')require('./funding-extension.cjs').load(dir,job.manifest,identity);
   const state=json(path.join(dir,'ledger.json')),funding=job.action==='sign-funding',role=funding?'funding':signingRole(job.manifest),fundingState=funding||job.action==='sign-relay-source'?{...state,...fundingHistory(dir,state)}:state,operation=job.action==='sign-relay-source'?authorizeRelaySource(job.manifest,fundingState,identity,validators):job.action==='sign-hinkal'&&job.manifest.request.version===14?authorizeProoflessHinkal(job.manifest,state,identity,validators):['sign-swap','sign-hinkal'].includes(job.action)?authorizeOperation(job.manifest,state,identity,validators):(funding?authorizeFunding:role==='recipient'?authorizeRecipientReturn:authorizePayment)(job.manifest,funding?fundingState:state,identity,validatePayment);
   if(job.action==='sign-swap'&&![9,11,12].includes(job.manifest.request.version)||job.action==='sign-hinkal'&&![10,14].includes(job.manifest.request.version))throw new ProfileError('Wrong test signing operation.');
   // Persist intent AND worst-case reservation before touching an unlock credential.
   const base=path.join(dir,operation.fingerprint.slice(2));write(base+'.manifest.json',JSON.stringify(job.manifest));state.operations.push(operation);write(path.join(dir,'ledger.json'),JSON.stringify(state));
   const key=dpapi('unprotect',fs.readFileSync(path.join(dir,role+'.unlock.dpapi')));let response,execution={};
   try{response=worker({action:'sign',vault:json(path.join(dir,role+'.vault.json')),password:key.toString('utf8'),request:job.manifest.request,fingerprint:operation.fingerprint},'worker.cjs',identity.fixtureOnly!==true,base+'.execution.json',execution);}finally{key.fill(0);}
   verifySigned(response,job.manifest.request,(role==='recipient'?identity.recipient:role==='funding'?identity.fundingSource:identity.source),false);persistSignedResponse(base,response,execution);operation.state='signed';operation.transactionHash=response.transactionHash;write(path.join(dir,'ledger.json'),JSON.stringify(state));
   return {transactionHash:response.transactionHash,fingerprint:operation.fingerprint,reservedUsdMicros:operation.reservedUsdMicros,responsePersisted:true,manifestHash:digest(job.manifest)};
  }finally{await unlock();}
 }
 throw new ProfileError('Unsupported isolated test profile action.');
}
module.exports={dpapi,worker,write,json,directory,lock,assertEvidenceClass,assertRequalificationSafe,safeProfileFailure,fundingHistory,persistSignedResponse};
if(require.main===module){let bytes=0,chunks=[];const clear=()=>{chunks.forEach(b=>b.fill(0));chunks=[];};process.stdin.on('data',b=>{bytes+=b.length;if(bytes>512*1024){b.fill(0);clear();process.exit(2);}chunks.push(b);});process.stdin.on('error',()=>{clear();process.exit(2);});process.stdin.on('end',async()=>{let raw;try{raw=Buffer.concat(chunks);clear();let job;try{job=JSON.parse(raw.toString('utf8'));}finally{raw.fill(0);}const result=await main(job);job=undefined;process.stdout.write(JSON.stringify({ok:true,result}));}catch(e){raw?.fill(0);clear();process.stdout.write(JSON.stringify({ok:false,error:safeProfileFailure(e)}));process.exitCode=1;}});}
