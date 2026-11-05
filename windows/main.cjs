const {bridgeCodec}=require('./tools/bridge-intent-codecs.cjs');
const paymentPolicy=require('./tools/store-payment-policy.cjs');
const {createFinalReceipt}=require('./preparation-import.cjs');
const {validateHinkalSolanaSwap,hinkalSolanaSwapReview,verifyHinkalSolanaSwapResponse,assertHinkalSolanaSwapWallet}=require('./dist/hinkal-solana-swap.cjs');
const {validateHinkalEvmSwap,hinkalEvmSwapReview,verifyHinkalEvmSwapResponse,assertHinkalEvmSwapWallet}=require('./dist/hinkal-evm-swap.cjs');
const {validateHinkalSolanaSpend,hinkalSolanaSpendReview,verifyHinkalSolanaSpendResponse,assertHinkalSolanaSpendWallet}=require('./dist/hinkal-solana-spend.cjs');
const {validateHinkalSolana,hinkalSolanaReview,verifyHinkalSolanaResponse,assertHinkalSolanaWallet}=require('./dist/hinkal-solana.cjs');
const {app, BrowserWindow, ipcMain, dialog, session, shell, clipboard, safeStorage} = require('electron');
// Grayscale antialiasing avoids colored fringes on small desktop text.
app.commandLine.appendSwitch('disable-lcd-text');
const {SignatureStore}=require('./signature-store.cjs');
const {TransactionStore,reconcileRecord}=require('./transaction-store.cjs');
const {createRecoveryStorage}=require('./tools/recovery-storage.cjs');
const {transactionSummary}=require('./transaction-summary.cjs');
const {validatePayment,paymentReview,verifyPaymentResponse,assertPaymentWallet,multiPublicSchema}=require('./dist/payment.cjs');
const {validateSwap,swapReview,verifySwapResponse,assertSwapWallet}=require('./dist/swap.cjs');
const {validateHinkal,hinkalReview,verifyHinkalResponse,assertHinkalWallet}=require('./dist/hinkal.cjs');
const {validateLifiEvm,lifiEvmReview,verifyLifiEvmResponse,assertLifiEvmWallet}=require('./dist/lifi-evm.cjs');
const {validateLifiSolana,lifiSolanaReview,verifyLifiSolanaResponse,assertLifiSolanaWallet}=require('./dist/lifi-solana.cjs');
const validateIntent=r=>bridgeCodec(r)?bridgeCodec(r).validate(r):r?.version===21?validateHinkalSolanaSwap(r):r?.version===18?validateHinkalEvmSwap(r):r?.version===16?validateHinkalSolanaSpend(r):r?.version===14?validateHinkalSolana(r):r?.version===11?validateLifiSolana(r):r?.version===12?validateLifiEvm(r):r?.version===10?validateHinkal(r):r?.version===9?validateSwap(r):validatePayment(r);
const reviewIntent=r=>bridgeCodec(r)?bridgeCodec(r).review(r):r?.version===21?hinkalSolanaSwapReview(r):r?.version===18?hinkalEvmSwapReview(r):r?.version===16?hinkalSolanaSpendReview(r):r?.version===14?hinkalSolanaReview(r):r?.version===11?lifiSolanaReview(r):r?.version===12?lifiEvmReview(r):r?.version===10?hinkalReview(r):r?.version===9?swapReview(r):paymentReview(r);
const assertIntentWallet=(r,w)=>bridgeCodec(r)?bridgeCodec(r).assertWallet(r,w):r?.version===21?assertHinkalSolanaSwapWallet(r,w):r?.version===18?assertHinkalEvmSwapWallet(r,w):r?.version===16?assertHinkalSolanaSpendWallet(r,w):r?.version===14?assertHinkalSolanaWallet(r,w):r?.version===11?assertLifiSolanaWallet(r,w):r?.version===12?assertLifiEvmWallet(r,w):r?.version===10?assertHinkalWallet(r,w):r?.version===9?assertSwapWallet(r,w):assertPaymentWallet(r,w);
const verifyIntent=(s,r,w,now,expiry)=>bridgeCodec(r)?bridgeCodec(r).verify(s,r,w,now,expiry):r?.version===21?verifyHinkalSolanaSwapResponse(s,r,w,now,expiry):r?.version===18?verifyHinkalEvmSwapResponse(s,r,w,now,expiry):r?.version===16?verifyHinkalSolanaSpendResponse(s,r,w,now,expiry):r?.version===14?verifyHinkalSolanaResponse(s,r,w,now,expiry):r?.version===11?verifyLifiSolanaResponse(s,r,w,now,expiry):r?.version===12?verifyLifiEvmResponse(s,r,w,now,expiry):r?.version===10?verifyHinkalResponse(s,r,w,now,expiry):r?.version===9?verifySwapResponse(s,r,w,now,expiry):verifyPaymentResponse(s,r,w,now,expiry);
const intentAction=(r,a)=>bridgeCodec(r)?bridgeCodec(r).action+a:r?.version===21?'hinkal-solana-swap-'+a:r?.version===18?'hinkal-evm-swap-'+a:r?.version===16?'hinkal-solana-spend-'+a:r?.version===14?'hinkal-solana-'+a:r?.version===11?'lifi-solana-'+a:r?.version===12?'lifi-evm-'+a:r?.version===10?'hinkal-direct-'+a:r?.version===9?'uniswap-v3-'+a:a;
const {makeReceiveInfo,receiveIdentity,makePaymentQR}=require('./dist/receive.cjs');
function scopedPaymentQR(wallet,input){paymentPolicy.assertPaymentInput(input);return makePaymentQR(wallet,input);}
const {updates,resolveWebRoute}=require('./web-links.cjs');
const {WalletStore,cleanName,vaultDigest}=require('./wallet-store.cjs');
const fs = require('node:fs/promises');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID,createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {RequestExchange} = require('./tools/request-exchange.cjs');
const requestExchange = new RequestExchange();
const ROOT = __dirname, ENTRY = pathToFileURL(path.join(ROOT,'ui','index.html')).href;
let win, encryptedVault, vaultFile, publicWallet, backupVerified=false, pendingReview, busy=false, activeWalletId=null;
const activeWorkers=new Set();
const publicReadControllers = new Set();
function cancelAccountReads() {
  for (const controller of publicReadControllers) controller.abort();
  publicReadControllers.clear();
}
// One writer per app profile prevents parallel windows from losing catalog edits.
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
const walletStore=new WalletStore(path.join(app.getPath('userData'),'wallet-catalog-v1.json'));
const watchStore=new WalletStore(path.join(app.getPath('userData'),'watch-catalog-v1.json'));
const storeFor=id=>watchStore.records.some(r=>r.id===id)?watchStore:walletStore;
const recoveryStorage=createRecoveryStorage(app.getPath('userData'),safeStorage);
const signatureStore=new SignatureStore(path.join(app.getPath('userData'),'signatures-v1'),recoveryStorage.forJournal('signatures'));
const transactionStore=new TransactionStore(path.join(app.getPath('userData'),'transactions-v1'),recoveryStorage.forJournal('transactions'));
const OFFLINE=process.env.DRIVEKEY_OFFLINE==='1'||require('./package.json').drivekeyOffline===true;
const rpcFile=path.join(app.getPath('userData'),'rpc-endpoints-v1.json');
async function online(input,options={}){if(OFFLINE)throw Error('Networking is disabled in the offline companion.');paymentPolicy.assertOnlineJob(input);let endpoints;try{endpoints=await readJSON(rpcFile);}catch{throw Error('Import an RPC configuration first.');}return job({...input,endpoints},'online-worker.cjs',options);}
const verifiedWallets=new Map();
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function passwordOf(v) { if(typeof v!=='string'||v.length<16||v.length>256) throw Error('Use a passphrase of 16–256 characters.'); return v; }
function clearPendingReview() {pendingReview=undefined;requestExchange.clearBinding();}
function reset() { cancelAccountReads();requestExchange.clear();encryptedVault=undefined; vaultFile=undefined; publicWallet=undefined; backupVerified=false; clearPendingReview();activeWalletId=null; }
function walletList(){const problem=walletStore.problem||watchStore.problem;return problem?{wallets:[],activeId:null,recoveryRequired:true,canRecover:problem.canRecover,error:problem.error}:{wallets:[...walletStore.list(activeWalletId,verifiedWallets).wallets,...watchStore.list(activeWalletId).wallets.map(w=>({...w,watchOnly:true}))],activeId:activeWalletId,recoveryRequired:false};}
function selectedWallet(){const wallet=storeFor(activeWalletId).get(activeWalletId);return {public:publicWallet,backupVerified,watchOnly:!encryptedVault,wallet:{id:wallet.id,name:wallet.name},...walletList()};}
function selectWallet(record,vault,file,identity){cancelAccountReads();requestExchange.clear();clearPendingReview();encryptedVault=vault;vaultFile=file;publicWallet=identity;activeWalletId=record.id;backupVerified=verifiedWallets.get(record.id)===record.vaultHash;return selectedWallet();}
async function job(input,worker='worker.cjs',{signal}={}) {
  signal?.throwIfAborted();
  const owner=win;
  const requireOwner=()=>{if(!owner||win!==owner||owner.isDestroyed?.())throw Error('Operation cancelled because the wallet window closed.');};
  requireOwner();
  const node = app.isPackaged ? path.join(process.resourcesPath,'node.exe') : (process.env.DRIVEKEY_NODE || process.execPath);
  const script=app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked','dist',worker):path.join(ROOT,'dist',worker);
  if(app.isPackaged){const integrity=require('./RUNTIME-INTEGRITY.json');for(const [key,file]of [['node.exe',node],['dist/'+worker,script]])if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==integrity[key])throw Error('Signing runtime integrity check failed.');}
  // Integrity reads yield. Closing or replacing the window during those reads
  // must not create a fresh, untracked key-bearing child afterwards.
  requireOwner();
  signal?.throwIfAborted();
  return new Promise((resolve,reject) => {
    // Narrow child environment; no inherited API keys or user NODE_OPTIONS.
    const env = {SystemRoot:process.env.SystemRoot, WINDIR:process.env.WINDIR, TEMP:process.env.TEMP, TMP:process.env.TMP, PATH:path.dirname(node)};
    const child=spawn(node,['--no-addons','--max-old-space-size=256',script],{cwd:app.isPackaged?process.resourcesPath:ROOT,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let bytes=0, parts=[], settled=false;
    const cancel=()=>{child.kill();finish(Error('Operation cancelled because the wallet window closed.'));};
    const cancelRead=()=>{child.kill();finish(Error('Public read cancelled.'));};
    const finish=(error,value)=>{ if(settled)return;signal?.removeEventListener('abort',cancelRead); settled=true;clearTimeout(timer);activeWorkers.delete(cancel);parts.forEach(b=>b.fill(0));parts=[];error?reject(error):resolve(value); };
    const timer=setTimeout(()=>{child.kill();finish(Error('Signer timed out. No result was accepted.'));},120000);
    activeWorkers.add(cancel);
    child.on('error',()=>finish(Error('Could not start the local signer worker.')));
    child.stdout.on('data',b=>{if(settled){b.fill(0);return;}bytes+=b.length;if(bytes>1024*1024){b.fill(0);child.kill();finish(Error('Signer output limit exceeded.'));}else parts.push(b);});
    // Do not display diagnostics from key-bearing workers.
    child.stderr.resume();
    child.on('close',(code,signal)=>{if(settled)return;let raw;try{raw=Buffer.concat(parts);const r=JSON.parse(raw.toString('utf8'));if(!r.ok||code!==0||signal!==null)throw Error();finish(null,r.result);}catch{finish(Error(worker==='worker.cjs'?'Local signer rejected the operation. Check the passphrase, vault and reviewed request.':'Network worker rejected the operation. Check the request and RPC configuration.'));}finally{raw?.fill(0);}});
    child.stdin.on('error',()=>{});
    signal?.addEventListener('abort',cancelRead,{once:true});
    if(signal?.aborted){cancelRead();return;}
    child.stdin.end(JSON.stringify(input)); input.password=undefined;
  });
}
async function readJSON(file) {
  const handle=await fs.open(file,'r');
  let buffer;
  try {const stat=await handle.stat();if(!stat.isFile()||stat.size>256*1024)throw Error('Choose a JSON file smaller than 256 KiB.');buffer=Buffer.alloc(256*1024+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>256*1024)throw Error('File size limit exceeded.');try{return JSON.parse(new (require('node:util').TextDecoder)('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead)));}catch{throw Error('The selected file is not valid UTF-8 JSON.');}} finally {buffer?.fill(0);await handle.close();}
}
async function openJSON(title) {
  const result=await dialog.showOpenDialog(win,{title,properties:['openFile'],filters:[{name:'DriveKey JSON',extensions:['json']}]});
  if(result.canceled)return null;
  return {file:result.filePaths[0],data:await readJSON(result.filePaths[0])};
}
async function saveJSON(title,name,data) {
  const result=await dialog.showSaveDialog(win,{title,defaultPath:name,filters:[{name:'DriveKey JSON',extensions:['json']}]});
  if(result.canceled)return null;
  // Never overwrite an existing vault, backup, request, or response.
  await fs.writeFile(result.filePath,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
  return result.filePath;
}
function requireVault() {if(!encryptedVault)throw Error('Create or open an encrypted vault first.');}
function requirePublic(){if(!publicWallet)throw Error('Select a software or watch-only wallet first.');}
function register(channel,handler) {
  ipcMain.handle(channel,async(event,payload)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==ENTRY)throw Error('Invalid sender.');
    if(busy)return {ok:false,error:'Finish the current operation first.'};
    busy=true;
    try{paymentPolicy.assertIpcChannel(channel);const result=await handler(payload);if(result?.token&&result?.review&&pendingReview?.token===result.token)return {ok:true,result:{...result,requestCreatedAt:pendingReview.request.createdAt}};return {ok:true,result};}catch(error){return {ok:false,error:(error instanceof Error?error.message:'Operation failed.').slice(0,400)};}finally{busy=false;}
  });
}
function registerPublicRead(channel,handler){let running=false;ipcMain.handle(channel,async(event,payload)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==ENTRY)throw Error('Invalid sender.');if(busy||running)return {ok:false,error:'Finish the current operation first.'};running=true;try{return {ok:true,result:await handler(payload)};}catch(error){return {ok:false,error:(error instanceof Error?error.message:'Public read unavailable.').slice(0,400)};}finally{running=false;}});}
const accountBalanceReader=require('./account-balances.cjs').createAccountBalanceReader({
 getWallets:()=>walletList().wallets,
 online:(input,signal)=>online(input,{signal}),
 isOffline:()=>OFFLINE
});
registerPublicRead('account-balances',async payload=>{
 const controller = new AbortController();
 publicReadControllers.add(controller);
 try { return await accountBalanceReader(payload,controller.signal); }
 finally { publicReadControllers.delete(controller); }
});
register('create-vault',async p=>{
  const password=passwordOf(p?.password);if(password!==p?.confirmation)throw Error('The passphrases do not match.');
  if(p?.name!==undefined)cleanName(p.name);await walletStore.init();
  const v=await job({action:'create',password});const file=await saveJSON('Save a NEW disposable vault','vault-multi-encrypted.json',v);if(!file)return {cancelled:true};
  const identity=(await job({action:'inspect',vault:v})).public,record=await walletStore.upsert(file,v,identity,p?.name);return selectWallet(record,v,file,identity);
});
register('load-vault',async()=>{
  await walletStore.init();
  const picked=await openJSON('Open encrypted multichain vault');if(!picked)return {cancelled:true};
  const inspected=await job({action:'inspect',vault:picked.data});
  const existing=walletStore.list().wallets.find(item=>item.deviceId===inspected.public.deviceId);
  const previousFile=existing?walletStore.get(existing.id).file:null;
  const record=await walletStore.upsert(picked.file,picked.data,inspected.public);
  // A separate-backup proof must be renewed when another copy becomes primary.
  if(previousFile!==null&&path.normalize(previousFile).toLowerCase()!==path.normalize(record.file).toLowerCase())verifiedWallets.delete(record.id);
  return selectWallet(record,picked.data,picked.file,inspected.public);
});
register('list-wallets',async()=>{try{await walletStore.init();await watchStore.init();}catch{}return walletList();});
register('import-watch-wallet',async()=>{
 if(OFFLINE)throw Error('The offline companion opens encrypted vaults. Import the public identity on the online computer.');const picked=await openJSON('Import public wallet exported by offline companion');if(!picked)return {cancelled:true};
 const identity=multiPublicSchema.parse(picked.data);await watchStore.init();const record=await watchStore.upsert(picked.file,identity,identity);selectWallet(record,undefined,picked.file,identity);return selectedWallet();
});
register('recover-wallet-list',async()=>{
  const recovering=walletStore.problem?walletStore:watchStore;
  if(!recovering.problem)throw Error('The saved wallet list does not need recovery.');
  // A repaired file can be read again without erasing a healthy wallet list.
  try{await recovering.retry();return {...walletList(),recovered:false};}catch{}
  if(!recovering.problem.canRecover)return walletList();
  const confirmation=await dialog.showMessageBox(win,{type:'warning',title:'Recover saved wallet list?',message:'Rebuild the saved wallet list?',detail:'DriveKey will preserve a copy of the damaged list, then start an empty wallet library. Your encrypted vault and backup files stay on disk. Open those files again to add your wallets.',buttons:['Cancel','Recover wallet list'],defaultId:0,cancelId:0,noLink:true});
  if(confirmation.response!==1)return {...walletList(),cancelled:true};
  const result=await recovering.recover();
  if(result.recovered){reset();verifiedWallets.clear();}
  return {...walletList(),...result};
});
register('activate-wallet',async p=>{
  await walletStore.init();await watchStore.init();const store=storeFor(p?.id),record=store.get(p?.id);
  let vault;try{vault=await readJSON(record.file);}catch{throw Error('The wallet file is missing or unreadable. Use Open vault to locate it.');}
  if(store===watchStore){const identity=multiPublicSchema.parse(vault);store.assertVault(record,vault,identity);return selectWallet(record,undefined,record.file,identity);}
  const inspected=await job({action:'inspect',vault});walletStore.assertVault(record,vault,inspected.public);return selectWallet(record,vault,record.file,inspected.public);
});
register('rename-wallet',async p=>{await storeFor(p?.id).rename(p?.id,p?.name);return walletList();});
register('remove-wallet',async p=>{await storeFor(p?.id).remove(p?.id);verifiedWallets.delete(p?.id);const cleared=activeWalletId===p?.id;if(cleared)reset();return {...walletList(),cleared};});
register('export-public',async()=>{requirePublic();const f=await saveJSON('Export public wallet for the dapp','wallet-multi-public.json',publicWallet);return {saved:!!f};});
register('export-backup',async()=>{requireVault();const f=await saveJSON('Save a separate encrypted backup','vault-multi-backup.json',encryptedVault);return {saved:!!f};});
register('verify-backup',async p=>{
  requireVault();const password=passwordOf(p?.password);const picked=await openJSON('Select the separate encrypted backup');if(!picked)return {cancelled:true};
  const [backupReal,vaultReal,backupStat,vaultStat]=await Promise.all([fs.realpath(picked.file),fs.realpath(vaultFile),fs.stat(picked.file),fs.stat(vaultFile)]);
  if(backupReal.toLowerCase()===vaultReal.toLowerCase()||(backupStat.dev===vaultStat.dev&&backupStat.ino===vaultStat.ino))throw Error('Select a separate backup file.');
  if(vaultDigest(picked.data)!==vaultDigest(encryptedVault))throw Error('This backup does not match the loaded vault.');
  await job({action:'verify',vault:picked.data,password});backupVerified=true;verifiedWallets.set(activeWalletId,vaultDigest(encryptedVault));return {verified:true,...walletList()};
});
register('import-request',async()=>{
  requireVault();clearPendingReview();
  const picked=await openJSON('Import unsigned DriveKey request');if(!picked)return {cancelled:true};
  paymentPolicy.assertIntent(picked.data);
  const review=await job({action:'review',request:picked.data,vault:encryptedVault});
  const token=randomUUID();pendingReview={token,request:picked.data,review,vaultHash:digest(encryptedVault)};return {token,review};
});
register('sign-request',async p=>{
  requireVault();if(!backupVerified)throw Error('Verify a separate encrypted backup before signing.');
  const password=passwordOf(p?.password),r=pendingReview;
  if(!r||p?.token!==r.token||p?.fingerprint!==r.review.fingerprint||r.vaultHash!==digest(encryptedVault))throw Error('Review expired or changed. Import the request again.');
  paymentPolicy.assertIntent(r.request);
  clearPendingReview(); // An approval token can be consumed only once.
  await recoveryStorage.ready();
  const refreshed=await job({action:'review',request:r.request,vault:encryptedVault});
  const terms=Object.entries(refreshed).map(([key,value])=>key+': '+(typeof value==='object'?JSON.stringify(value):value)).join('\n');
  const confirm=await dialog.showMessageBox(win,{type:'warning',title:'Approve this exact transaction?',message:'Create a transferable signature?',detail:terms+'\n\nLocal software signing trusts the running computer. No transaction is broadcast here.',buttons:['Cancel','Approve exact transaction'],defaultId:0,cancelId:0,noLink:true});
  if(confirm.response!==1)return {cancelled:true,reviewConsumed:true};
  const previous=await signatureStore.load(publicWallet.deviceId,r.review.fingerprint.slice(2));
  let response;
  if(previous){await job({action:'verify',vault:encryptedVault,password});response=(await job({action:'verify-saved',vault:encryptedVault,request:previous.request,response:previous.response})).response;}
  else{
    response=await job({action:'sign',vault:encryptedVault,password,request:r.request,fingerprint:r.review.fingerprint});
    // A transferable result must be durable before a save picker or renderer reply.
    try{response=(await signatureStore.save(publicWallet.deviceId,r.request,response)).response;}
    catch{throw Error('Could not preserve encrypted signature recovery. No response was exported. Keep this profile and import the same request to retry.');}
  }
  const file=await saveJSON('Export signed response — return it to the dapp',r.request.network==='ethereum'?'signed-trade-response.json':'signed-multi-response.json',response);
  return {saved:!!file,reviewConsumed:true,transactionHash:response.transactionHash,recoverable:true,warning:file?'Return this file to the dapp for verification.':'Signature created but export cancelled. No broadcast occurred. Export it again from Saved signatures.'};
});
register('list-signatures',async()=>{
  requireVault();const records=await signatureStore.list(publicWallet.deviceId);
  return records.map(record=>({id:record.request.fingerprint.slice(2),requestId:record.request.requestId,network:record.request.network,signedAt:record.response.signedAt,transactionHash:record.response.transactionHash}));
});
register('export-signature',async p=>{
  requireVault();const stored=await signatureStore.load(publicWallet.deviceId,p?.id);if(!stored)throw Error('Saved signature not found for this wallet.');
  const checked=await job({action:'verify-saved',vault:encryptedVault,request:stored.request,response:stored.response});
  const terms=Object.entries(checked.review).map(([key,value])=>key+': '+value).join('\n');
  const confirmation=await dialog.showMessageBox(win,{type:'warning',title:'Export a saved signature?',message:'Export the previously approved transaction?',detail:terms+'\n\nThis creates no new signature. The application deadline does not revoke the existing signature. Check the original request and current chain state in the dapp before submitting.',buttons:['Cancel','Export saved signature'],defaultId:0,cancelId:0,noLink:true});
  if(confirmation.response!==1)return {cancelled:true};
  const file=await saveJSON('Export saved signature — verify in the dapp','signed-recovered-response.json',checked.response);
  return {saved:!!file,transactionHash:checked.response.transactionHash};
});
register('clear-session',async()=>{reset();verifiedWallets.clear();return {cleared:true,...walletList()};});
register('receive-info',async p=>{requirePublic();paymentPolicy.assertChain(p?.network);return makeReceiveInfo(publicWallet,p.network);});
register('copy-address',async p=>{requirePublic();paymentPolicy.assertChain(p?.network);const info=receiveIdentity(publicWallet,p.network);try{await clipboard.writeText(info.address);if(await clipboard.readText()!==info.address)throw Error();}catch{throw Error('Clipboard unavailable. Use the displayed QR code or address.');}return {copied:true,network:info.network};});
register('open-web',async p=>{if(OFFLINE)throw Error('External links are disabled in the offline companion.');if(!['article','market-data'].includes(p?.route))throw Error(paymentPolicy.notice);const destination=resolveWebRoute(p.route,p.option);await shell.openExternal(destination.url);return {opened:true,...destination};});
register('list-updates',async()=>updates);
const marketService=require('./market-data.cjs').createMarketService({isOffline:()=>OFFLINE});
registerPublicRead('market-snapshot',p=>marketService.snapshot(p));
const interfaceZoomLevels=Object.freeze([0.5,0.67,0.8,1,1.25,1.5,1.75,2]);
register('interface-settings',async()=>({zoom:win.webContents.getZoomFactor()}));
register('set-interface-zoom',async p=>{if(!p||Object.keys(p).length!==1||typeof p.zoom!=='number'||!interfaceZoomLevels.includes(p.zoom))throw Error('Choose a supported interface zoom level.');win.webContents.setZoomFactor(p.zoom);return {zoom:win.webContents.getZoomFactor()};});
register('application-mode',async()=>({offline:OFFLINE,version:require('./package.json').version,fundingReady:false,networks:['ethereum','solana','sepolia','devnet'],capabilities:{publicPayments:true,uniswapV3:false,lifiSwaps:false,relayBridge:false,preparedPrivateImport:false,preparedMayanImport:false,privateProofCreation:false,privateBalanceDiscovery:false,savings:false}}));
register('payment-qr',async p=>{requirePublic();return scopedPaymentQR(publicWallet,p);});
register('payment-balance',async p=>{requirePublic();if(!p||!['ethereum','sepolia','solana','devnet'].includes(p.chain)||!['ETH','SOL','USDC'].includes(p.asset)||Object.keys(p).some(k=>!['chain','asset'].includes(k)))throw Error('Invalid balance request.');const from=['ethereum','sepolia'].includes(p.chain)?publicWallet.evmAddress:publicWallet.solanaAddress;return online({action:'balance',chain:p.chain,asset:p.asset,from});});
register('export-payment-receipt',async p=>{requirePublic();const r=await transactionStore.load(publicWallet.deviceId,p?.id);const receipt=createFinalReceipt(r);verifyIntent(r.response,r.request,publicWallet,Date.now(),false);const f=await saveJSON('Save finalized payment receipt','drivekey-payment-receipt.json',receipt);return {saved:!!f};});
register('configure-rpc',async()=>{
 if(OFFLINE)throw Error('Offline companion has no networking.');const picked=await openJSON('Import RPC configuration');if(!picked)return {cancelled:true};
 const entries=Object.entries(picked.data);if(!entries.length||entries.length>4)throw Error('Invalid RPC configuration.');
 for(const [chain,url]of entries){if(!['ethereum','sepolia','solana','devnet'].includes(chain)||typeof url!=='string'||url.length>2048)throw Error('Invalid RPC configuration.');const u=new URL(url);if(u.username||u.password||u.hash||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('RPC must use HTTPS or localhost.');}
 let saved={};try{saved=await readJSON(rpcFile);}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.writeFile(rpcFile,JSON.stringify({...saved,...picked.data}),{mode:0o600});cancelAccountReads();accountBalanceReader.clear();clearPendingReview();return {configured:true};
});
register('prepare-payment',async p=>{
 requirePublic();clearPendingReview();const request=validatePayment(await online({action:'prepare',input:p,wallet:publicWallet}));assertPaymentWallet(request,publicWallet);
 paymentPolicy.assertIntent(request);
 const token=randomUUID(),review=paymentReview(request);
 await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});
 pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};return {token,review};
});
register('prepare-swap',async p=>{
 requirePublic();clearPendingReview();const request=validateSwap(await online({action:'uniswap-v3-prepare',input:p,wallet:publicWallet}));assertSwapWallet(request,publicWallet);
 const token=randomUUID(),review=swapReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};
});
for(const [channel,version] of [['prepare-lifi-mayan-evm-source',22],['prepare-mayan-solana-source',23],['prepare-mayan-evm-redeem',24],['prepare-lifi-relay-solana',25],['prepare-lifi-relay-evm',26]])register(channel,async p=>{requirePublic();clearPendingReview();const codec=bridgeCodec({version}),raw=await online({action:codec.action+'prepare',input:p,wallet:publicWallet});if(raw?.version!==version)throw Error('Prepared bridge version differs from the selected route.');const request=codec.validate(raw);codec.assertWallet(request,publicWallet);const token=randomUUID(),review=codec.review(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('reconcile-lifi-mayan-destination',async p=>{requirePublic();const record=await transactionStore.load(publicWallet.deviceId,p?.id);if(record?.request?.version!==22||!record.response||['prepared','signed'].includes(record.state))throw Error('A submitted LI.FI source is required.');verifyIntent(record.response,record.request,publicWallet,Date.now(),false);const result=await online({action:'lifi-mayan-solana-destination-reconcile',request:record.request,response:record.response});if(!['confirmed','destination-pending','pending','uncertain','conflict','failed'].includes(result?.state)||result.state==='confirmed'&&result.completeRoute!==true)throw Error('Invalid destination reconciliation response.');await transactionStore.put(reconcileRecord(record,result,{destination:true}));return result;});
register('prepare-lifi-solana',async p=>{requirePublic();clearPendingReview();const request=validateLifiSolana(await online({action:'lifi-solana-prepare',input:p,wallet:publicWallet}));assertLifiSolanaWallet(request,publicWallet);const token=randomUUID(),review=lifiSolanaReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('hinkal-discover',async p=>{requirePublic();return online({action:'hinkal-discover',input:p});});
register('prepare-lifi-evm',async p=>{requirePublic();clearPendingReview();const request=validateLifiEvm(await online({action:'lifi-evm-prepare',input:p,wallet:publicWallet}));assertLifiEvmWallet(request,publicWallet);const token=randomUUID(),review=lifiEvmReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('prepare-hinkal-solana-swap',async p=>{requirePublic();clearPendingReview();const request=validateHinkalSolanaSwap(await online({action:'hinkal-solana-swap-prepare',input:p,wallet:publicWallet}));assertHinkalSolanaSwapWallet(request,publicWallet);const token=randomUUID(),review=hinkalSolanaSwapReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('prepare-hinkal-evm-swap',async p=>{requirePublic();clearPendingReview();const request=validateHinkalEvmSwap(await online({action:'hinkal-evm-swap-prepare',input:p,wallet:publicWallet}));assertHinkalEvmSwapWallet(request,publicWallet);const token=randomUUID(),review=hinkalEvmSwapReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('prepare-hinkal-solana-spend',async p=>{requirePublic();clearPendingReview();const request=validateHinkalSolanaSpend(await online({action:'hinkal-solana-spend-prepare',input:p,wallet:publicWallet}));assertHinkalSolanaSpendWallet(request,publicWallet);const token=randomUUID(),review=hinkalSolanaSpendReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('prepare-hinkal-solana',async p=>{requirePublic();clearPendingReview();const request=validateHinkalSolana(await online({action:'hinkal-solana-prepare',input:p,wallet:publicWallet}));assertHinkalSolanaWallet(request,publicWallet);const token=randomUUID(),review=hinkalSolanaReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
register('prepare-hinkal',async p=>{requirePublic();clearPendingReview();const request=validateHinkal(await online({action:'hinkal-direct-prepare',input:p,wallet:publicWallet}));assertHinkalWallet(request,publicWallet);const token=randomUUID(),review=hinkalReview(request);pendingReview={token,request,review,vaultHash:encryptedVault?digest(encryptedVault):null};await transactionStore.put({version:1,request,state:'prepared',updatedAt:new Date().toISOString()});return {token,review};});
function exchangeScope() {
 requirePublic();
 if(OFFLINE||encryptedVault)throw Error('Exchange folders require an online public wallet.');
 return JSON.stringify([win?.id,activeWalletId,publicWallet]);
}
function importScope() {requirePublic();return {window:win,wallet:publicWallet,id:activeWalletId};}
function assertImportScope(scope) {
 if(!scope.window||scope.window.isDestroyed()||win!==scope.window||publicWallet!==scope.wallet||activeWalletId!==scope.id)throw Error('Wallet or window changed during import.');
}
register('choose-request-exchange',async()=>{
 const scope=exchangeScope(),owner=win;
 const selected=await dialog.showOpenDialog(win,{title:'Choose request exchange folder',properties:['openDirectory']});
 if(owner!==win||owner.isDestroyed()||scope!==exchangeScope())throw Error('Wallet or window changed during folder selection.');
 if(selected.canceled)return {cancelled:true};
 return requestExchange.choose(selected.filePaths[0],scope);
});
register('clear-request-exchange',async()=>{requestExchange.clear();return {cleared:true};});
register('export-payment-request',async()=>{
 requirePublic();
 if(!pendingReview)throw Error('Prepare an intent first.');
 paymentPolicy.assertIntent(pendingReview.request);
 if(!OFFLINE&&!encryptedVault&&requestExchange.available(exchangeScope())){
  const request=validateIntent(pendingReview.request);assertIntentWallet(request,publicWallet);
  return requestExchange.export(request,pendingReview.token,exchangeScope());
 }
 const file=await saveJSON('Transfer request to offline companion','request-v'+pendingReview.request.version+'.json',pendingReview.request);return {saved:!!file};
});
async function ingestResponse(data,scope,expected) {
 assertImportScope(scope);
 const record=await transactionStore.load(scope.wallet.deviceId,data?.fingerprint);assertImportScope(scope);
 if(!record)throw Error('No matching prepared intent for this wallet.');
 paymentPolicy.assertIntent(record.request);
 if(expected&&!isDeepStrictEqual(record.request,expected))throw Error('Response differs from the current reviewed request.');
 const response=verifyIntent(data,record.request,scope.wallet,Date.now(),Boolean(expected));
 const old=await signatureStore.load(scope.wallet.deviceId,record.request.fingerprint.slice(2));assertImportScope(scope);
 if(old&&old.response.rawSignedTransaction!==response.rawSignedTransaction)throw Error('A different response already exists for this intent.');
 await signatureStore.save(scope.wallet.deviceId,record.request,response);assertImportScope(scope);
 if(['prepared','signed'].includes(record.state))await transactionStore.put({...record,response,state:'signed'});
 return {imported:true,transactionHash:response.transactionHash};
}
register('import-payment-response',async()=>{
 const scope=importScope(),picked=await openJSON('Import response from offline companion');
 if(!picked)return {cancelled:true};return ingestResponse(picked.data,scope);
});
register('import-exchange-response',async()=>{
 const scope=importScope(),binding=exchangeScope();
 if(!pendingReview)throw Error('Review the exported request first.');
 paymentPolicy.assertIntent(pendingReview.request);
 const request=validateIntent(pendingReview.request);assertIntentWallet(request,scope.wallet);
 const picked=requestExchange.response(request,pendingReview.token,binding);
 return ingestResponse(picked.data,scope,request);
});
register('list-transactions',async()=>{
 requirePublic();const records=await transactionStore.list(publicWallet.deviceId),saved=await signatureStore.list(publicWallet.deviceId);
 for(const s of saved.filter(s=>[8,9,10,11,12,14,16,18,21,22,23,24,25,26].includes(s.request.version))){let record=records.find(r=>r.request.fingerprint===s.request.fingerprint);if(!record){record={version:1,request:s.request,state:'uncertain',response:s.response,reason:'Submission history is missing. Reconcile the saved hash; do not rebroadcast.'};records.push(record);await transactionStore.put(record);}else if(record.state==='prepared'){record.state='signed';record.response=s.response;await transactionStore.put(record);}}
 return records.map(transactionSummary);
});
register('submit-payment',async p=>{
 requirePublic();if(OFFLINE)throw Error('Offline companion cannot broadcast.');const record=await transactionStore.load(publicWallet.deviceId,p?.id);
 if(!record?.response||record.state!=='signed')throw Error('Only a signed, never-submitted intent can be submitted. Reconcile prior submissions.');
 paymentPolicy.assertIntent(record.request);
 const r=validateIntent(record.request);verifyIntent(record.response,r,publicWallet,Date.now(),false);
 const confirmation=await dialog.showMessageBox(win,{type:'warning',title:'Submit transaction?',message:'Broadcast the approved transaction?',detail:Object.entries(reviewIntent(r)).map(([k,v])=>k+': '+v).join('\n'),buttons:['Cancel','Broadcast exact transaction'],defaultId:0,cancelId:0,noLink:true});
 if(confirmation.response!==1)return {cancelled:true};
 // V14 broadcasts perform the full preflight in the same worker that sends.
 if(r.version!==14)await online({action:intentAction(r,'preflight'),request:r});
 await transactionStore.put({...record,state:'submitting',updatedAt:new Date().toISOString()});
 try{await online({action:intentAction(r,'broadcast'),request:r,response:record.response});await transactionStore.put({...record,state:'pending',updatedAt:new Date().toISOString()});return {submitted:true};}
 catch{await transactionStore.put({...record,state:'uncertain',reason:'Submission result unknown. Reconcile the approved hash. No automatic retry.'});throw Error('Submission result unknown. Reconcile before any further action.');}
});
register('reconcile-payment',async p=>{
 requirePublic();const record=await transactionStore.load(publicWallet.deviceId,p?.id);if(!record?.response||record.state==='prepared')throw Error('No signed transaction to reconcile.');verifyIntent(record.response,record.request,publicWallet,Date.now(),false);
 const result=await online({action:[25,26].includes(record.request.version)?'lifi-relay-destination-reconcile':intentAction(record.request,'reconcile'),request:record.request,response:record.response});if(!['confirmed','failed','pending','uncertain','conflict','expired-unresolved','destination-pending'].includes(result?.state)||[25,26].includes(record.request.version)&&result.state==='confirmed'&&result.completeRoute!==true)throw Error('Invalid reconciliation response.');
 await transactionStore.put(reconcileRecord(record,result));return result;
});
require('./ui-routes-main.cjs').installRouteUi({
 register,dialog,clipboard,transactionStore,bridgeCodec,validateIntent,reviewIntent,assertIntentWallet,verifyIntent,online,makePaymentQR:scopedPaymentQR,
 getPublic:()=>{requirePublic();return publicWallet;},getWindow:()=>win,isOffline:()=>OFFLINE,
 clearPending:clearPendingReview,setPending:value=>{pendingReview=value;},
 getVaultHash:()=>encryptedVault?digest(encryptedVault):null
});
app.whenReady().then(()=>{
  if(!primaryInstance)return;
  const isolated=session.fromPartition('drivekey-connect-preview');
  isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  const allowed=new Set(['index.html','shell.js','routes.js','chooser.js','chooser.css','black.css','portfolio.js','workspace.js','assets.js',...require('./ui-assets.json'),'app.js','style.css','vendor/tabler.min.css','assets/drivekey-logo.jpg','assets/usb-pcb-hero.png','assets/usb-pcb-detail.png','assets/solana.png','assets/hinkal.svg','assets/provider-lifi.svg','assets/provider-jupiter.png','assets/provider-uniswap.svg','assets/provider-husher.png','assets/chain-ethereum.svg','assets/Inter.woff2','assets/SpaceGrotesk.woff2'].map(f=>pathToFileURL(path.join(ROOT,'ui',f)).href));
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed.has(details.url)}));
  win=new BrowserWindow({width:1440,height:1000,minWidth:850,minHeight:650,backgroundColor:'#080c12',show:true,autoHideMenuBar:true,title:OFFLINE?'DriveKey Offline Companion':'DriveKey Windows',webPreferences:{session:isolated,preload:path.join(ROOT,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==ENTRY)event.preventDefault();});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.once('ready-to-show',()=>win.show());
  win.on('closed',()=>{for(const cancel of activeWorkers)cancel();reset();verifiedWallets.clear();win=undefined;});
  win.loadURL(ENTRY);
});
app.on('window-all-closed',()=>app.quit());
