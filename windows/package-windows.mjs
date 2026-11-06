import {packager} from '@electron/packager';
import {flipFuses,FuseVersion,FuseV1Options} from '@electron/fuses';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url));
const workspace=path.resolve(root,'../..');
const separateRoot=process.env.DRIVEKEY_WINDOWS_BUILD_ROOT;
if(separateRoot&&!path.isAbsolute(separateRoot))throw Error('The Windows build root must be absolute.');
const resultRoot=separateRoot?await mkdtemp(path.join(path.resolve(separateRoot),'drivekey-windows-')):root;
const outputDir=path.join(resultRoot,'builds');
const stageBase=separateRoot?path.join(resultRoot,'scratch'):path.join(workspace,'work','package-v7-'+Date.now());
await mkdir(stageBase,{recursive:true});
// Explicit build input; no runtime fetch, fallback or unsigned artifact upgrade.
const artifactStage=path.join(stageBase,'hinkal-prover');
const {stageProofArtifacts}=createRequire(path.join(root,'package.json'))('./tools/proof-artifacts.cjs');
await stageProofArtifacts(process.env.DRIVEKEY_HINKAL_ARTIFACTS,artifactStage);
try{await stat(outputDir);const previous=path.join(stageBase,'previous-builds');if(!previous.startsWith(workspace+path.sep))throw Error('Invalid build archive path.');await (await import('node:fs/promises')).rename(outputDir,previous);}catch(e){if(e.code!=='ENOENT')throw e;}
const meta=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
// Reuse the previously verified signed Node runtime, without changing the earlier release.
const nodeSource=process.execPath;
const hash=async f=>createHash('sha256').update(await readFile(f)).digest('hex');
async function copyDirectory(source,dest){await mkdir(dest,{recursive:true});for(const e of await readdir(source,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('No symlinks in application stage.');const a=path.join(source,e.name),b=path.join(dest,e.name);if(e.isDirectory())await copyDirectory(a,b);else await copyFile(a,b);}}
const runtimes={};for(const file of ['worker.cjs','online-worker.cjs','product-proof-worker.cjs','product-view-worker.cjs','provider-proof-worker.cjs','public-note-worker.cjs','public-note-math-worker.cjs'])runtimes['dist/'+file]=await hash(path.join(root,'dist',file));runtimes['node.exe']=await hash(nodeSource);
await writeFile(path.join(root,'RUNTIME-INTEGRITY.json'),JSON.stringify(runtimes,null,2)+'\n');
const results=[];
for(const offline of [false,true]){
 const label=offline?'DriveKey Offline Companion':'DriveKey Windows',stage=path.join(stageBase,offline?'offline':'windows');await mkdir(stage,{recursive:true});
 for(const file of ['main.cjs','preload.cjs','preparation-import.cjs','market-data.cjs','account-balances.cjs','transaction-summary.cjs','ui-routes-main.cjs','ui-assets.json','wallet-store.cjs','signature-store.cjs','transaction-store.cjs','web-links.cjs','RUNTIME-INTEGRITY.json'])await copyFile(path.join(root,file),path.join(stage,file));
 await mkdir(path.join(stage,'tools'),{recursive:true});
 for(const file of ['bridge-intent-codecs.cjs','request-exchange.cjs','store-payment-policy.cjs','recovery-storage.cjs','native-product-proof.cjs','native-private-view.cjs','native-note-discovery.cjs','native-public-history.cjs','public-history-journal.cjs','public-note-pages.cjs','private-note-claims.cjs','native-provider-finalizer.cjs','provider-finalizations.cjs','native-product-admission.cjs','strict-json.cjs','signing-attempts.cjs','native-signing-recovery.cjs','request-lifecycle.cjs'])await copyFile(path.join(root,'tools',file),path.join(stage,'tools',file));
 await copyDirectory(path.join(root,'ui'),path.join(stage,'ui'));await mkdir(path.join(stage,'dist'),{recursive:true});
 for(const file of ['hinkal-note-history.cjs','hinkal-note-snapshot.cjs','private-note-manifest.cjs','hinkal-view.cjs','hinkal-view-crypto.cjs','hinkal-provider-proof.cjs',...offline?[]:['public-note-math-worker.cjs','public-note-worker.cjs','product-view-worker.cjs','provider-proof-worker.cjs']])await copyFile(path.join(root,'dist',file),path.join(stage,'dist',file));
 await copyFile(path.join(root,'dist','hinkal-product-proof.cjs'),path.join(stage,'dist','hinkal-product-proof.cjs'));
 await copyFile(path.join(root,'dist','hinkal-product-result.cjs'),path.join(stage,'dist','hinkal-product-result.cjs'));
 await copyFile(path.join(root,'dist','hinkal-product-chain.cjs'),path.join(stage,'dist','hinkal-product-chain.cjs'));
 await copyFile(path.join(root,'dist','hinkal-product-admission.cjs'),path.join(stage,'dist','hinkal-product-admission.cjs'));
 await copyFile(path.join(root,'dist','product-proof-worker.cjs'),path.join(stage,'dist','product-proof-worker.cjs'));
 await copyFile(path.join(root,'THIRD-PARTY-NOTICES.txt'),path.join(stage,'THIRD-PARTY-NOTICES.txt'));
 for(const file of ['worker.cjs','payment.cjs','swap.cjs','hinkal.cjs','hinkal-proof-link.cjs','lifi-evm.cjs','lifi-solana.cjs','lifi-mayan-evm.cjs','lifi-relay.cjs','mayan-solana.cjs','mayan-evm-redeem.cjs','hinkal-solana.cjs','hinkal-solana-spend.cjs','hinkal-evm-swap.cjs','hinkal-solana-swap.cjs','receive.cjs',...offline?[]:['online-worker.cjs']])await copyFile(path.join(root,'dist',file),path.join(stage,'dist',file));
 await writeFile(path.join(stage,'package.json'),JSON.stringify({name:offline?'drivekey-offline-companion':'drivekey-windows',version:meta.version,main:'main.cjs',description:'DriveKey Windows payments',drivekeyOffline:offline}));
 const [dir]=await packager({dir:stage,name:label,platform:'win32',arch:'x64',electronVersion:meta.devDependencies.electron,icon:path.join(root,'ui/assets/blue/app.ico'),out:outputDir,tmpdir:separateRoot?stageBase:undefined,asar:{unpack:'**/dist/{worker,online-worker,product-proof-worker,product-view-worker,provider-proof-worker,public-note-worker,public-note-math-worker}.cjs'},prune:false,overwrite:false,extraResource:[nodeSource,path.join(root,'THIRD-PARTY-NOTICES.txt'),artifactStage]});
 const copiedNode=path.join(dir,'resources',path.basename(nodeSource));if(path.basename(nodeSource)!=='node.exe')await copyFile(copiedNode,path.join(dir,'resources','node.exe'));
 const exe=path.join(dir,label+'.exe');await flipFuses(exe,{version:FuseVersion.V1,[FuseV1Options.RunAsNode]:false,[FuseV1Options.EnableCookieEncryption]:true,[FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,[FuseV1Options.EnableNodeCliInspectArguments]:false,[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:true,[FuseV1Options.OnlyLoadAppFromAsar]:true});
 results.push({kind:offline?'offline':'windows',directory:path.relative(resultRoot,dir),executable:path.relative(resultRoot,exe),sha256:await hash(exe),asarSHA256:await hash(path.join(dir,'resources','app.asar')),publisherSigned:false});
}
await writeFile(path.join(resultRoot,'WINDOWS-BUILDS.json'),JSON.stringify({builtAt:new Date().toISOString(),electron:meta.devDependencies.electron,builds:results,limitations:['Unsigned DriveKey publisher executable; no distribution approval','Offline build omits online-worker; physical separation across two computers is unverified']},null,2)+'\n');console.log('Built Windows and offline companion candidates at '+resultRoot+'. Publisher signing remains required.');
