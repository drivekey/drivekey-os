'use strict';
const $ = id => document.getElementById(id);
const ui = {offline:false,public:null,wallets:[],activeId:null,name:'',watchOnly:false,exchangeFolder:null,backupVerified:false,recovery:null,revision:0,review:null,token:null,origin:null,page:'home',records:[],receiveEpoch:0,qrEpoch:0,qr:null};
const titles={home:'Home',vault:'Accounts',payments:'Send',receive:'Receive',swap:'Swap',private:'Private',activity:'Transaction history',review:'Review & sign',signatures:'Saved signatures',security:'Security & backup',settings:'Settings'};
let apiQueue=Promise.resolve(),lastFocus=null,expiryTimer;
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(className)e.className=className;return e;}
function art(name){const e=node('img',undefined,'art-icon');e.src='assets/blue/icon-'+name+'-256.png';e.alt='';e.setAttribute('aria-hidden','true');return e;}
function button(text,handler,className=''){const e=node('button',text,className);e.type='button';e.dataset.operation='';e.onclick=handler;return e;}
function notify(message,error=false){$('toast-message').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;}
$('dismiss-toast').onclick=()=>$('toast').hidden=true;
function formMessage(form,message,error=false){const e=form?.querySelector('.form-status');if(e){e.textContent=message;e.classList.toggle('error',error);}if(error)notify(message,true);}
function api(method,...args){
 const run=async()=>{
  const controls=[...document.querySelectorAll('[data-operation]')].map(e=>[e,e.disabled]);
  controls.forEach(([e])=>e.disabled=true);$('working').hidden=false;document.querySelector('.workspace').setAttribute('aria-busy','true');
  try{if(typeof window.drivekey?.[method]!=='function')throw Error('This operation is unavailable in this build.');const response=await window.drivekey[method](...args);if(!response?.ok)throw Error(response?.error||'Operation could not be completed.');return response.result;}
  catch(error){notify(error.message||'Operation could not be completed.',true);return null;}
  finally{controls.forEach(([e,disabled])=>e.disabled=disabled);updateSignGate();ui.routeControls?.restoreControls?.();$('working').hidden=true;document.querySelector('.workspace').setAttribute('aria-busy','false');}
 };
 const result=apiQueue.then(run,run);apiQueue=result.then(()=>undefined,()=>undefined);return result;
}
function invalid(id,message){const field=$(id);if(field){for(let details=field.closest('details');details;details=details.parentElement?.closest('details'))details.open=true;field.setAttribute('aria-invalid','true');const status=field.closest('form')?.querySelector('.form-status');if(status){status.id=status.id||id+'-error';status.textContent=message;field.setAttribute('aria-describedby',status.id);}field.focus();}const error=Error(message);error.validationError=true;throw error;}
document.addEventListener('input',event=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement)event.target.removeAttribute('aria-invalid');});
function publicRecipient(value,chain){return ['ethereum','sepolia'].includes(chain)?/^0x[0-9a-fA-F]{40}$/.test(value):/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);}
function decimals(asset){if(asset==='USDC')return 6;if(asset==='SOL')return 9;if(asset==='ETH')return 18;throw Error('Unsupported asset.');}
function units(value,asset){const d=decimals(asset);if(typeof value!=='string'||!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.trim()))throw Error('Enter a positive decimal amount.');const [whole,fraction='']=value.trim().split('.');if(fraction.length>d)throw Error(asset+' supports up to '+d+' decimal places.');const n=BigInt(whole+fraction.padEnd(d,'0'));if(n<=0n||n.toString().length>38)throw Error('Amount is outside the supported range.');return n.toString();}
function formatUnits(value,asset){try{const d=decimals(asset),s=String(value);if(!/^[0-9]+$/.test(s))return 'Unavailable';const p=s.padStart(d+1,'0'),fraction=p.slice(-d).replace(/0+$/,'');return p.slice(0,-d)+(fraction?'.'+fraction:'');}catch{return 'Unavailable';}}
function shortAddress(s){return typeof s==='string'&&s.length>20?s.slice(0,8)+'…'+s.slice(-6):s||'—';}
function dateLabel(value){const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Time unavailable';}
function updateReviewNavigation() {
  const control = document.querySelector('.nav-item[data-view="review"]');
  const loaded = Boolean(ui.review);
  control.dataset.requestLoaded = String(loaded);
  control.setAttribute('aria-label', loaded ? 'Review & sign, request loaded' : 'Review & sign');
  control.title = loaded ? 'Review & sign · request loaded' : 'Review & sign';
}
function updateExchangeControls() {
 const available=Boolean(ui.public&&ui.watchOnly&&!ui.offline);
 $('exchange-folder-controls').hidden=!available;
 $('clear-exchange-folder').hidden=!ui.exchangeFolder;
 $('import-exchange').hidden=!available||!ui.exchangeFolder;
 $('exchange-folder-status').textContent=ui.exchangeFolder
  ? 'Exchange folder · '+ui.exchangeFolder+'. Each request uses its own folder.'
  : 'Choose a folder before preparing a request to reuse it for file exchange.';
}
$('choose-exchange-folder').onclick=async()=>{
 const result=await api('chooseRequestExchange');
 if(result?.folder){ui.exchangeFolder=result.folder;updateExchangeControls();}
};
$('clear-exchange-folder').onclick=async()=>{
 const result=await api('clearRequestExchange');
 if(result?.cleared){ui.exchangeFolder=null;updateExchangeControls();}
};
function clearReview(){ui.revision++;ui.review=null;ui.token=null;ui.origin=null;ui.proofToGenerate=null;$('product-prove-pass').value='';$('product-prove-form').hidden=true;clearInterval(expiryTimer);$('review-empty').hidden=false;$('review-loaded').hidden=true;$('signed').hidden=true;$('terms').replaceChildren();$('advanced-terms').replaceChildren();$('sign-pass').value='';$('approval').checked=false;$('review-status').textContent='No request loaded';$('handoff-status').textContent='';updateReviewNavigation();}
function invalidate(){clearReview();return api('invalidatePreparedReview');}
function clearQR(){ui.receiveEpoch++;ui.qr=null;$('receive-address').textContent='—';$('receive-qr').hidden=true;$('receive-qr').removeAttribute('src');$('receive-qr-empty').hidden=false;$('copy-address').disabled=true;$('amount-qr').hidden=true;$('amount-qr').removeAttribute('src');$('request-qr-empty').hidden=false;$('qr-uri').textContent='';$('qr-context').textContent='';$('copy-request').hidden=true;}
function resetLocal(){clearReview();clearQR();ui.public=null;ui.activeId=null;ui.name='';ui.backupVerified=false;ui.watchOnly=false;ui.exchangeFolder=null;updateExchangeControls();ui.records=[];document.querySelectorAll('input[type=password]').forEach(e=>e.value='');$('home-balances').replaceChildren(node('p','Balances have not been checked.'));$('balance-display').textContent='Balance not checked';$('balance-time').textContent='';}
function showCreate(show){$('vault-empty').hidden=!show||Boolean(ui.recovery);$('wallet-create-heading').hidden=!show||Boolean(ui.recovery);$('cancel-new-wallet').hidden=ui.wallets.length===0;}
function goto(name,{focus=true}={}){
 if(name==='swap'||name==='private')return;
 if(ui.offline&&!['vault','review','signatures','security','settings'].includes(name))name='review';if(!titles[name])return;
 ui.page=name;document.querySelectorAll('[data-page]').forEach(e=>e.hidden=e.dataset.page!==name);document.querySelectorAll('[data-view]').forEach(e=>{if(e.dataset.view===name)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});$('breadcrumb').textContent=titles[name];$('sidebar').classList.remove('expanded');$('nav-toggle').setAttribute('aria-expanded','false');
 if(focus)document.querySelector('[data-page="'+name+'"] h1')?.focus();
 if(name==='activity')refreshActivity();if(name==='receive')renderReceive();if(name==='signatures')refreshSignatures();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)goto(b.dataset.view);});
$('nav-toggle').onclick=()=>{const expanded=$('sidebar').classList.toggle('expanded');$('nav-toggle').setAttribute('aria-expanded',String(expanded));if(expanded)$('sidebar').querySelector('.nav-item:not([hidden])')?.focus();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('sidebar').classList.contains('expanded')){$('sidebar').classList.remove('expanded');$('nav-toggle').setAttribute('aria-expanded','false');$('nav-toggle').focus();}});
function updateContext(){
 const selected=Boolean(ui.public);$('vault-pill').textContent=ui.recovery?'Wallet list unavailable':selected?ui.name:'Choose a wallet';$('context-kind').textContent=selected?(ui.watchOnly?'Public wallet · watch only':'Local encrypted wallet'):'Your wallet workspace';
 $('home-empty').hidden=selected;$('home-active').hidden=!selected;$('vault-loaded').hidden=!selected;$('active-wallet-name').textContent=ui.name||'Wallet';$('wallet-kind').textContent=ui.watchOnly?'Public wallet · watch only':'Encrypted at rest';
 for(const [id,value]of [['evm',ui.public?.evmAddress],['sol',ui.public?.solanaAddress],['device',ui.public?.deviceId]])$(id).textContent=value||'—';
 $('home-wallet-name').textContent=ui.name;$('home-wallet-type').textContent=ui.watchOnly?'Public wallet · signing stays with its owner':'Local encrypted wallet · Ethereum & Solana';
 $('home-next-title').textContent=ui.watchOnly?'Signing stays separate':ui.backupVerified?'Ready for exact review':'Verify your backup';
 $('home-next-copy').textContent=ui.watchOnly?'Export requests for the wallet owner to review and sign.':ui.backupVerified?'Import a request and check every term before approving.':'Reopen a separate backup before signing this session.';
 $('security-wallet').textContent=selected?ui.name+' · '+(ui.watchOnly?'public wallet':'local signer'):'None selected';$('security-signing').textContent=!selected?'Choose a wallet':ui.watchOnly?'Unavailable for public wallets':'Local software signing';$('backup-state').textContent=ui.watchOnly?'Not available for public wallets':ui.backupVerified?'Backup verified this session':'Not verified this session';$('security-mode').textContent=ui.offline?'Offline companion · file exchange only':'Windows payments · ETH, SOL and USDC';$('backup-tools').hidden=!selected||ui.watchOnly;
 $('sign-environment').textContent=ui.offline?'Disconnect this computer before signing. This software mode does not prove physical isolation.':'Local software signing trusts this computer. You can also export the request for your offline companion.';
 updateSignGate();renderWallets();ui.routeControls?.refresh();
}
function applyWallets(result){if(!result)return;ui.wallets=Array.isArray(result.wallets)?result.wallets:ui.wallets;ui.recovery=result.recoveryRequired?{message:result.error,canRecover:result.canRecover}:null;if('activeId'in result)ui.activeId=result.activeId;const active=ui.wallets.find(w=>w.id===ui.activeId);if(active&&ui.public){ui.name=active.name;ui.backupVerified=Boolean(active.backupVerified);}updateContext();}
async function selectWallet(result){if(!result||result.cancelled||!result.public)return;resetLocal();ui.public=result.public;ui.activeId=result.wallet?.id||result.activeId;ui.name=result.wallet?.name||'Wallet';ui.watchOnly=Boolean(result.watchOnly);ui.backupVerified=Boolean(result.backupVerified);applyWallets(result);showCreate(false);goto('vault');notify(ui.watchOnly?'Public wallet selected. Signing stays with its owner.':'Wallet selected.');await refreshActivity();}
async function refreshWallets(){const result=await api('listWallets');if(result){applyWallets(result);showCreate(!ui.wallets.length);}else{ui.recovery={message:'Wallet list could not be opened. Your vault files stay on disk.',canRecover:false};updateContext();}}
function renderWallets(){
 const list=$('wallet-list');list.replaceChildren();$('wallet-count').textContent=ui.wallets.length;$('wallet-recovery').hidden=!ui.recovery;$('wallet-recovery-message').textContent=ui.recovery?.message||'';$('recover-wallet-list').textContent=ui.recovery?.canRecover?'Recover wallet list':'Retry wallet list';$('wallet-search-row').hidden=Boolean(ui.recovery)||!ui.wallets.length;$('wallet-list-empty').hidden=Boolean(ui.recovery)||ui.wallets.length>0;
 for(const id of ['new-wallet','add-wallet-file','import-watch','start','open-home','open-vault'])$(id).disabled=Boolean(ui.recovery);
 const q=$('wallet-search').value.trim().toLowerCase(),matches=ui.wallets.filter(w=>[w.name,w.evmAddress,w.solanaAddress].some(v=>String(v||'').toLowerCase().includes(q)));$('wallet-search-empty').hidden=!ui.wallets.length||matches.length>0;
 if(ui.recovery){showCreate(false);return;}
 list.setAttribute('role','table');list.setAttribute('aria-label','Accounts');
 const header=node('div',undefined,'account-table-head');header.setAttribute('role','row');for(const name of ['Name','Public address','Assets','Est. value','Actions']){const h=node('span',name);h.setAttribute('role','columnheader');header.append(h);}list.append(header);
 for(const w of matches){const row=node('article',undefined,'wallet-row account-table-row'+(w.id===ui.activeId?' is-active':''));row.dataset.walletId=w.id;row.setAttribute('role','row');
 const name=node('div',undefined,'account-name');name.append(art('wallet'));const copy=node('span');const open=button(w.name,()=>openAccount(w),'text-button account-open');open.setAttribute('aria-label','View account '+w.name);copy.append(open,node('small',w.watchOnly?'Public wallet':w.backupVerified?'Backup verified':'Local encrypted wallet'));name.append(copy);
 const addresses=node('code',shortAddress(w.evmAddress)+' · '+shortAddress(w.solanaAddress));addresses.title='Ethereum '+w.evmAddress+'; Solana '+w.solanaAddress;
 const assets=node('div',undefined,'account-assets');for(const [src,label]of [['assets/chain-ethereum.svg','Ethereum'],['assets/solana.png','Solana'],['assets/asset-usdc.svg','USDC']]){const img=node('img');img.src=src;img.alt=label;assets.append(img);}
 const value=node('span',w.id===ui.activeId?'Not checked':'Select to view');value.dataset.accountValue=w.id;
 const actions=node('div',undefined,'actions'),use=button(w.id===ui.activeId?'Selected':'Use wallet',async()=>selectWallet(await api('activateWallet',w.id)));use.disabled=w.id===ui.activeId;actions.append(use,button('Rename',()=>editWallet(w,'rename'),'text-button'),button('Remove',()=>editWallet(w,'remove'),'text-button'));
 for(const cell of [name,addresses,assets,value,actions]){cell.setAttribute('role','cell');row.append(cell);}list.append(row);}

}
async function openAccount(wallet) {
  if (wallet.id !== ui.activeId) {
    const result = await api('activateWallet', wallet.id);
    if (!result?.public) return;
    await selectWallet(result);
  }
  goto(ui.offline ? 'vault' : 'home');
  if (ui.offline) $('vault-loaded').scrollIntoView({block: 'start'});
}

function openDialog(dialog,returnFocus=document.activeElement){lastFocus=returnFocus;dialog.showModal();dialog.querySelector('input,button,[tabindex]')?.focus();}
for(const id of ['wallet-dialog','transaction-dialog']){
 const dialog=$(id);
 dialog.addEventListener('close',()=>{if(lastFocus?.isConnected)lastFocus.focus();else document.querySelector('.page:not([hidden]) h1')?.focus();});
 dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length);
  if(!controls.length){event.preventDefault();return;}
  const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
  if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
 });
}
function editWallet(wallet,mode){const dialog=$('wallet-dialog'),content=$('wallet-dialog-content');content.replaceChildren();$('wallet-dialog-title').textContent=mode==='rename'?'Rename wallet':'Remove wallet from app?';const confirm=$('wallet-dialog-confirm');confirm.textContent=mode==='rename'?'Save name':'Remove from app';confirm.className=mode==='remove'?'danger':'primary';if(mode==='rename'){const label=node('label','Wallet name'),input=node('input');input.id='wallet-name-edit';input.value=wallet.name;input.maxLength=40;input.required=true;input.autocomplete='off';label.append(input);content.append(label);}else{content.append(node('p',wallet.name),node('p','Your vault and backup files stay on disk.'));}$('wallet-dialog-form').onsubmit=async e=>{e.preventDefault();const result=await api(mode==='rename'?'renameWallet':'removeWallet',wallet.id,...mode==='rename'?[$('wallet-name-edit').value]:[]);if(!result)return;if(result.cleared)resetLocal();applyWallets(result);showCreate(!ui.wallets.length);dialog.close();notify(mode==='rename'?'Wallet renamed.':'Wallet removed from this app. Files kept.');};openDialog(dialog);}
$('wallet-dialog-cancel').onclick=()=>$('wallet-dialog').close();$('wallet-search').oninput=renderWallets;$('wallet-selector').onclick=()=>goto('vault');$('new-wallet').onclick=()=>{showCreate(true);$('new-wallet-name').focus();};$('start').onclick=()=>{goto('vault');showCreate(true);$('new-wallet-name').focus();};$('cancel-new-wallet').onclick=()=>{showCreate(false);$('create-form').reset();};
for(const id of ['open-home','open-vault','add-wallet-file'])$(id).onclick=async()=>selectWallet(await api('loadVault'));
async function importWatch(){selectWallet(await api('importWatchWallet'));}$('import-watch').onclick=importWatch;document.querySelector('[data-action=import-watch]').onclick=importWatch;
$('recover-wallet-list').onclick=async()=>{const result=await api(ui.recovery?.canRecover?'recoverWalletList':'listWallets');if(result?.recovered)resetLocal();applyWallets(result);showCreate(!ui.wallets.length);};
$('create-form').onsubmit=async e=>{e.preventDefault();const pass=$('new-pass').value,confirmation=$('confirm-pass').value,name=$('new-wallet-name').value.trim();$('new-pass').value='';$('confirm-pass').value='';if(pass!==confirmation){formMessage(e.target,'The passphrases do not match.',true);$('new-pass').focus();return;}selectWallet(await api('createVault',pass,confirmation,name||undefined));};
$('public').onclick=async()=>{const r=await api('exportPublic');if(r?.saved)notify('Public wallet exported.');};$('backup').onclick=async()=>{const r=await api('exportBackup');if(r?.saved)notify('Encrypted backup saved. Reopen it below to verify.');};
$('backup-form').onsubmit=async e=>{e.preventDefault();const pass=$('backup-pass').value;$('backup-pass').value='';const result=await api('verifyBackup',pass);if(result?.verified){ui.backupVerified=true;applyWallets(result);formMessage(e.target,'Backup verified this session.');notify('Backup verified this session.');}else if(result?.cancelled)formMessage(e.target,'Backup selection canceled.');};
async function clearSession(){const result=await api('clear');if(result){resetLocal();applyWallets(result);showCreate(!ui.wallets.length);goto(ui.offline?'review':'home');notify('Session cleared. Saved wallet files are kept.');}}$('lock').onclick=clearSession;$('settings-clear').onclick=clearSession;
const labelMap={from:'From',recipient:'Recipient',chain:'Chain',network:'Network',asset:'Asset',amount:'Amount',baseUnits:'Amount in base units',maximumFee:'Maximum network fee',maximumFeeBaseUnits:'Maximum fee in base units',deadlineUTC:'Deadline (UTC)',expiresAt:'Expires at',fingerprint:'Request fingerprint',tokenContract:'Token contract',transactionTarget:'Transaction target',recipientAccountRent:'Recipient account rent',createRecipientAccount:'Create recipient account',deviceId:'Wallet identity',requestId:'Request ID',minimumOutput:'Minimum output',slippageBps:'Slippage (basis points)'};
function labelFor(key){return labelMap[key]||key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase());}
function addTerm(dl,key,value){const row=node('div'),dt=node('dt',labelFor(key)),dd=node('dd',typeof value==='object'?JSON.stringify(value,null,2):value);row.dataset.field=key;if(key==='amount')row.className='primary-term';if(/address|recipient|fingerprint|hash|from|target/i.test(key))dd.className='technical-value';row.append(dt,dd);dl.append(row);}
function displayedTerm(key,value,review){
 const raw=String(value),input=review.inputAsset||review.tokenIn||review.asset,output=review.outputAsset||review.tokenOut||review.asset;
 const chain=review.sourceChain||review.chain||review.network,native=chain==='solana'||chain==='devnet'?'SOL':'ETH';
 const destination=review.destinationChain,destinationNative=destination==='solana'||destination==='devnet'?'SOL':'ETH';
 let asset;
 if(['amount','grossInput','depositoryInput','protocolFee','maximumProtocolFee'].includes(key))asset=input;
 if(['minimumOutput','quotedOutput'].includes(key))asset=output;
 if(['maximumFeeBaseUnits','maximumSourceNetworkFee'].includes(key))asset=native;
 if(['accountRentBaseUnits','recipientAccountRentBaseUnits'].includes(key))asset=native;
 if(key==='destinationMaximumFeeBaseUnits'||key==='destinationNativeGasDropBaseUnits')asset=destinationNative;
 if(['redeemFee','circleMaxFee','maximumMayanFee'].includes(key))asset='USDC';
 if(asset&&['ETH','SOL','USDC'].includes(asset)&&/^[0-9]+$/.test(raw))return formatUnits(raw,asset)+' '+asset+' ('+raw+' base units)';
 if(key==='slippageBps'&&/^[0-9]+$/.test(raw))return (Number(raw)/100)+'% ('+raw+' basis points)';
 const networks={ethereum:'Ethereum · Mainnet',solana:'Solana · Mainnet',sepolia:'Sepolia · Testnet',devnet:'Solana Devnet · Testnet'};
 if(key==='network'&&['ethereum','solana'].includes(raw))return raw==='ethereum'?'Ethereum family':'Solana family';if(['chain','sourceChain','destinationChain'].includes(key)&&networks[raw])return networks[raw];
 return value;
}
function buildTerms(review,primary,advanced){
 primary.replaceChildren();advanced?.replaceChildren();
 const priority=['action','provider','amount','grossInput','formattedInput','sourceChain','chain','network','destinationChain','from','recipient','asset','inputAsset','tokenIn','outputAsset','tokenOut','minimumOutput','formattedMinimum','maximumFee','maximumFeeBaseUnits','maximumSourceNetworkFee','applicationDeadlineUTC','deadlineUTC','fingerprint'];
 const entries=Object.entries(review||{}).sort(([a],[b])=>(priority.indexOf(a)<0?100:priority.indexOf(a))-(priority.indexOf(b)<0?100:priority.indexOf(b)));
 for(const [key,value]of entries){const important=priority.includes(key)||/recipient|minimum|fee|rent|slippage|deadline|expiry|expires|spender|allowance|contract|asset|destination.*chain/i.test(key);addTerm(important||!advanced?primary:advanced,key,displayedTerm(key,value,review));}
 const inputAsset=review.inputAsset||review.tokenIn||review.asset,source=review.sourceChain||review.chain,native=['solana','devnet'].includes(source)?'SOL':'ETH',rawAmount=review.baseUnits||review.grossInput||review.amount,rawFee=review.maximumFeeBaseUnits||review.maximumSourceNetworkFee,rawRent=review.accountRentBaseUnits||'0';
 if(inputAsset===native&&['payment','swap','bridge'].includes(review.action)&&[rawAmount,rawFee,rawRent].every(v=>/^[0-9]+$/.test(String(v)))){const total=(BigInt(rawAmount)+BigInt(rawFee)+BigInt(rawRent)).toString();addTerm(primary,'maximumNativeDebit',formatUnits(total,native)+' '+native+' (amount + maximum network fee + rent)');}
}
function deadlineOf(review){
 if(!review)return null;
 const deadlines=['deadlineUTC','expiresAt','applicationDeadline','applicationDeadlineUTC','onchainDeadlineUTC'].map(k=>Date.parse(review[k])).filter(Number.isFinite);
 if(/^[0-9]+$/.test(String(review.protocolDeadlineUnix||'')))deadlines.push(Number(review.protocolDeadlineUnix)*1000);
 return deadlines.length?Math.min(...deadlines):null;
}
function reviewExpired(){const deadline=deadlineOf(ui.review);return deadline!==null&&Date.now()>=deadline;}
function updateSignGate(){updateReviewNavigation();updateExchangeControls();const gate=$('sign-gate');let text='';if(!ui.public)text='Choose a wallet before signing.';else if(ui.watchOnly)text='This is a public wallet. Export the request for its owner to sign.';else if(!ui.backupVerified)text='Verify a separate encrypted backup before signing.';else if(reviewExpired())text='This request expired. Prepare and review a new request.';gate.textContent=text;gate.hidden=!text;if(text)$('sign-pass').value='';$('sign-submit').disabled=Boolean(text)||!ui.token;$('sign-pass').disabled=Boolean(text);$('approval').disabled=Boolean(text);$('export-payment').disabled=!ui.review||reviewExpired();$('import').disabled=!ui.public||ui.watchOnly;$('sign-submit').textContent=ui.review?.kind==='private-proof'?'Authorize exact private proof':"Approve exact transaction";}
function acceptPrepared(result,origin='prepared'){if(!result?.token||!result.review)return;ui.token=result.token;ui.review=result.review;ui.origin=origin;$('review-created').textContent=(result.requestCreatedAt?'Request created '+dateLabel(result.requestCreatedAt)+'.':'Request creation time not supplied. Check expiry.')+(/swap|bridge/.test(String(result.review.action))?' Provider quote timestamp is not supplied.':'');for(const id of ['file-export-wallet','file-import-wallet'])$(id).textContent='Wallet: '+(ui.name||'selected wallet')+' · '+(result.review.from||ui.public?.deviceId||'');$('file-export-status').textContent='Ready to export';$('file-sign-status').textContent='Open the request on the signing computer. Review every term before approval.';$('file-import-status').textContent='No signed response imported';$('review-empty').hidden=true;$('signed').hidden=true;$('review-loaded').hidden=false;$('review-status').textContent='Ready for exact review';buildTerms(result.review,$('terms'),$('advanced-terms'));$('review-advanced').hidden=!$('advanced-terms').children.length;$('handoff-panel').hidden=ui.offline||!['prepared','product-proof-package'].includes(origin);$('sign-pass').value='';$('approval').checked=false;const update=()=>{const deadline=deadlineOf(result.review);$('review-expiry').textContent=reviewExpired()?'Request expired. Prepare and review a new request.':deadline?'Request expires '+dateLabel(new Date(deadline).toISOString())+'.':'Review the validated request limits below.';$('review-expiry').classList.toggle('warning',Boolean(reviewExpired()));updateSignGate();};clearInterval(expiryTimer);expiryTimer=setInterval(update,1000);update();goto('review');notify('Request ready. Review the exact terms before signing.');}
async function prepare(method,input){const invalidation=invalidate(),revision=ui.revision,identity=ui.public?.deviceId;await invalidation;if(revision!==ui.revision||identity!==ui.public?.deviceId)return null;if(!identity){notify('Choose a wallet first.',true);goto('vault');return null;}const result=await api(method,input);if(revision!==ui.revision||identity!==ui.public?.deviceId){await api('invalidatePreparedReview');return null;}if(result?.cancelled){notify('File selection canceled.');return null;}if(result)acceptPrepared(result);return result;}
$('import').onclick=async()=>{clearReview();const revision=ui.revision,identity=ui.public?.deviceId;const result=await api('importRequest');if(revision!==ui.revision||identity!==ui.public?.deviceId){await api('invalidatePreparedReview');return;}if(result?.cancelled)notify('Request selection canceled.');else if(result)acceptPrepared(result,'imported');};
$('sign-form').onsubmit=async e=>{
 e.preventDefault();if(!ui.token||!ui.review||ui.watchOnly||!ui.backupVerified||reviewExpired())return;
 const pass=$('sign-pass').value,token=ui.token,fingerprint=ui.review.fingerprint,isProof=ui.review.kind==='private-proof';$('sign-pass').value='';
 const result=await api(isProof?'authorizeProductProof':'sign',token,fingerprint,pass);clearReview();if(!result)return;
 if(result.cancelled){notify('Approval canceled. Import the request again to review.');return;}
 $('review-empty').hidden=true;$('signed').hidden=false;
 $('review-status').textContent=isProof?'Private-proof authorization saved':'Signed response saved';
 $('signed-title').textContent=isProof?(result.saved?'Private-proof authorization exported':'Private-proof authorization saved'):(result.saved?'Signed response exported':'Signed response saved');
 $('signed-message').textContent=isProof?result.warning:(result.saved?'Return the response to the online app for verification.':'Export was canceled. Use Saved signatures to export the same response.');
 $('tx-identifier-label').textContent=isProof?'Authorization fingerprint':'Transaction identifier';
 $('tx-hash').textContent=(isProof?result.authorizationFingerprint:result.transactionHash)||'—';
 notify(isProof?(result.saved?'Private-proof authorization exported. No chain transaction was signed.':'Private-proof authorization saved. Export was canceled.'):(result.saved?'Signed response exported. Nothing has been submitted.':'Signed response saved. Export was canceled.'));
 await refreshSignatures();if(isProof)await refreshProductProofs();
};
$('next-review').onclick=()=>{clearReview();$('import').focus();};
$('export-payment').onclick=async()=>{if(!ui.review||reviewExpired())return;const r=await api('exportPaymentRequest');if(r){$('file-export-status').textContent=r.saved?(r.exchangeFolder?'Request exported · '+r.requestDirectory+'/request.json':'Request exported'):'Export canceled';$('handoff-status').textContent=r.saved?'Request exported. Review it in your companion, then import the signed response.':'Export canceled. The request is still ready for review.';}};
async function importResponse(method='importPaymentResponse'){const r=await api(method);if(r?.imported){$('file-import-status').textContent='Signed response verified';$('file-sign-status').textContent='Signature verified against the exact request';$('handoff-status').textContent='Signed response verified. Open Activity to review and submit.';notify('Signed response verified. Nothing has been submitted.');await refreshActivity();goto('activity');}else if(r?.cancelled)notify('Response selection canceled.');}$('import-payment').onclick=()=>importResponse();$('import-exchange').onclick=()=>importResponse('importExchangeResponse');
$('payment-form').onsubmit=async e=>{e.preventDefault();try{const chain=$('payment-chain').value,recipient=$('payment-recipient').value.trim();if(!publicRecipient(recipient,chain))invalid('payment-recipient','Enter a full address for the selected network.');let amount;try{amount=units($('payment-amount').value,$('payment-asset').value);}catch(error){invalid('payment-amount',error.message);}await prepare('preparePayment',{chain,asset:$('payment-asset').value,recipient,amount});}catch(error){formMessage(e.target,error.message,true);}};
function updateAssets(chainId,assetId){const previous=$(assetId).value,native=['solana','devnet'].includes($(chainId).value)?'SOL':'ETH';$(assetId).replaceChildren(...[native,'USDC'].map(v=>{const o=node('option',v);o.value=v;return o;}));if([native,'USDC'].includes(previous))$(assetId).value=previous;}
$('payment-chain').onchange=()=>{updateAssets('payment-chain','payment-asset');$('balance-display').textContent='Balance not checked';invalidate();};for(const id of ['payment-asset','payment-recipient','payment-amount'])$(id).addEventListener('input',()=>{if(id==='payment-asset')$('balance-display').textContent='Balance not checked';invalidate();});
$('payment-balance').onclick=async()=>{const identity=ui.public?.deviceId,chain=$('payment-chain').value,asset=$('payment-asset').value;if(!identity){notify('Choose a wallet first.',true);return;}const result=await api('paymentBalance',{chain,asset});if(identity===ui.public?.deviceId&&chain===$('payment-chain').value&&asset===$('payment-asset').value)$('balance-display').textContent=result?formatUnits(result.amount,asset)+' '+asset:'Balance unavailable';};
$('refresh-balances').onclick=async()=>{if(!ui.public||ui.offline)return;const identity=ui.public.deviceId,container=$('home-balances');container.replaceChildren();for(const [chain,asset]of [['ethereum','ETH'],['ethereum','USDC'],['solana','SOL'],['solana','USDC']]){if(identity!==ui.public?.deviceId)return;const row=node('div',undefined,'asset-line');row.append(node('strong','Checking '+asset+'…'),node('span',chain==='ethereum'?'Ethereum':'Solana'));container.append(row);const result=await api('paymentBalance',{chain,asset});if(identity!==ui.public?.deviceId)return;row.firstChild.textContent=result?formatUnits(result.amount,asset)+' '+asset:asset+' unavailable';}$('balance-time').textContent='Checked '+new Date().toLocaleTimeString();};
async function renderReceive(){const epoch=++ui.receiveEpoch,identity=ui.public?.deviceId;$('receive-address').textContent='—';$('receive-qr').hidden=true;$('receive-qr-empty').hidden=false;$('copy-address').disabled=true;if(!identity){$('receive-notice').textContent='Choose a wallet to receive.';return;}const result=await api('receiveInfo',$('receive-network').value);if(epoch!==ui.receiveEpoch||identity!==ui.public?.deviceId)return;if(!result){$('receive-notice').textContent='Receive details unavailable.';return;}$('receive-address').textContent=result.address;$('receive-qr').src=result.qr;$('receive-qr').hidden=false;$('receive-qr-empty').hidden=true;$('copy-address').disabled=false;$('receive-notice').textContent='Receive '+result.asset+' on '+result.network+'.';}
$('receive-network').onchange=renderReceive;$('copy-address').onclick=async()=>{const r=await api('copyAddress',$('receive-network').value);if(r?.copied)notify('Public address copied.');};
document.querySelectorAll('[data-receive-tab]').forEach(b=>b.onclick=()=>{const address=b.dataset.receiveTab==='address';$('receive-address-panel').hidden=!address;$('receive-request-panel').hidden=address;document.querySelectorAll('[data-receive-tab]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));if(address)renderReceive();});
function clearRequestQR(){ui.qrEpoch++;ui.qr=null;$('amount-qr').hidden=true;$('amount-qr').removeAttribute('src');$('request-qr-empty').hidden=false;$('copy-request').hidden=true;$('qr-uri').textContent='';$('qr-context').textContent='';}
$('qr-chain').onchange=()=>{updateAssets('qr-chain','qr-asset');clearRequestQR();};for(const id of ['qr-asset','qr-amount'])$(id).addEventListener('input',clearRequestQR);
$('qr-form').onsubmit=async e=>{e.preventDefault();try{const input={chain:$('qr-chain').value,asset:$('qr-asset').value,amount:units($('qr-amount').value,$('qr-asset').value)},identity=ui.public?.deviceId,revision=ui.revision;clearRequestQR();const qrEpoch=ui.qrEpoch,r=await api('paymentQR',input);if(!r||qrEpoch!==ui.qrEpoch||identity!==ui.public?.deviceId||revision!==ui.revision||input.chain!==$('qr-chain').value||input.asset!==$('qr-asset').value)return;ui.qr=input;$('amount-qr').src=r.qr;$('amount-qr').hidden=false;$('request-qr-empty').hidden=true;$('qr-uri').textContent=r.uri;$('qr-context').textContent=formatUnits(r.amount,r.asset)+' '+r.asset+' · '+r.chain;$('copy-request').hidden=false;}catch(error){formMessage(e.target,error.message,true);}};
$('copy-request').onclick=async()=>{if(!ui.qr)return;const r=await api('copyPaymentRequest',ui.qr);if(r?.copied)notify('Payment request copied.');};
const statusLabels={prepared:'Request ready',discarded:'Local draft discarded','signing-uncertain':'Signing outcome unknown',signed:'Signed · not submitted',submitting:'Submission in progress',pending:'Pending confirmation','destination-pending':'Destination pending',confirmed:'Confirmed',failed:'Failed',uncertain:'Outcome unknown',conflict:'Conflicting evidence','expired-unresolved':'Expired · outcome unresolved'};
function statusPill(state){const p=node('span',statusLabels[state]||state,'pill');if(state==='confirmed')p.classList.add('success');else if(['uncertain','signing-uncertain','conflict','destination-pending','expired-unresolved'].includes(state))p.classList.add('warning');else if(state==='failed')p.classList.add('error');return p;}
function recordName(r){return r.action?labelFor(r.action):r.version>=22?'Bridge':String(r.asset||'Payment')+(String(r.asset||'').includes('→')?' swap':' payment');}
function recordAmount(record) {
  const asset = record.inputAsset || record.asset;
  if (!/^[0-9]+$/.test(record.amount || '')) return 'Amount unavailable';
  return ['ETH', 'SOL', 'USDC'].includes(asset)
    ? (record.direction === 'approval' ? 'Limit ' : '') + formatUnits(record.amount, asset) + ' ' + asset
    : record.amount + ' base units';
}

function makeActivityRow(record) {
  const hidden = document.body.dataset.hideBalances === 'true';
  const row = button('', () => openTransaction(record.id), 'activity-row history-table-row');
  row.dataset.transactionId = record.id;

  const symbol = record.inputAsset || record.asset;
  const identity = node('span', undefined, 'transaction-identity');
  const logo = window.DriveKeyAssets?.icon(symbol);
  const visual = node('span', undefined, 'history-icon');
  visual.append(logo || art(record.outputAsset ? 'swap' : 'send'));
  const direction = node('span', ['swap', 'bridge'].includes(record.direction) ? '⇄' : record.direction === 'withdraw' ? '↓' : record.direction === 'approval' ? '✓' : '↑', 'history-direction');
  direction.title = record.direction || 'Sent';
  direction.setAttribute('aria-hidden', 'true');
  visual.append(direction);
  identity.append(visual);
  const name = node('span');
  name.append(node('strong', recordName(record)));
  const provider = node('small', record.provider || 'Provider unavailable', 'history-provider');
  const providerIcon = window.DriveKeyAssets?.icon(record.provider);
  if (providerIcon) provider.prepend(providerIcon);
  name.append(provider);
  identity.append(name);

  const account = node('span', undefined, 'history-address');
  account.append(node('span', record.source ? 'From ' + shortAddress(record.source) : ui.name));
  account.append(node('small', 'To ' + shortAddress(record.recipient)));
  account.append(node('small', (record.chain || record.network || 'Network unavailable') +
    (record.destinationNetwork ? ' → ' + record.destinationNetwork : '')));
  account.title = [record.source, record.recipient].filter(Boolean).join(' → ');

  const amounts = node('span', undefined, 'history-amounts');
  amounts.append(node('span', hidden ? '••••' : recordAmount(record), 'amount'));
  if (record.outputAsset) {
    const output = /^[0-9]+$/.test(record.outputAmount || '')
      ? formatUnits(record.outputAmount, record.outputAsset) + ' ' + record.outputAsset
      : 'Awaiting settlement · ' + record.outputAsset;
    amounts.append(node('small', hidden ? '••••' : '→ ' + output, 'history-output'));
  }

  const valuation = window.DriveKeyPortfolio?.valuation(symbol, record.amount);
  const value = node('span', undefined, 'history-value');
  value.append(node('span', valuation?.label || 'Unavailable'));
  value.append(node('small', valuation ? (valuation.stale ? 'Stale estimate' : 'Estimated now') : 'Value unavailable'));
  if (valuation) value.title = 'Price observed ' + dateLabel(valuation.asOf);

  const status = node('span', undefined, 'history-status');
  status.append(statusPill(record.state), node('small', dateLabel(record.createdAt || record.updatedAt)));
  if (/^[0-9]+$/.test(record.actualFee || '')) {
    status.append(node('small', hidden ? '••••' : 'Fee ' + formatUnits(record.actualFee, record.feeAsset) + ' ' + record.feeAsset));
  }
  row.append(identity, account, amounts, value, status);
  return row;
}

function groupedHistoryRows(records){const nodes=[];if(records.length){const header=node('div',undefined,'history-table-header');for(const label of ['Type / Provider','Account / Address','Asset / Amount','Est. value','Status / Time'])header.append(node('span',label));nodes.push(header);}let previous=null;for(const r of records){const date=Date.parse(r.createdAt||r.updatedAt),day=Number.isFinite(date)?new Date(date).toLocaleDateString(undefined,{dateStyle:'long'}):'Date unavailable';if(day!==previous){nodes.push(node('h3',day,'history-date'));previous=day;}nodes.push(makeActivityRow(r));}return nodes;}
function renderActivity(){const q=$('activity-search').value.toLowerCase(),network=$('activity-network').value,status=$('activity-state').value,rows=ui.records.filter(r=>(network==='all'||r.network===network)&&(status==='all'||r.state===status)&&[r.asset,r.action,r.id,r.recipient,r.transactionHash].some(v=>String(v||'').toLowerCase().includes(q)));$('activity-list').replaceChildren(...groupedHistoryRows(rows));if(!rows.length)$('activity-list').append(node('p',ui.records.length?'No matching activity.':'No activity yet.'));$('home-activity').replaceChildren(...ui.records.slice(0,3).map(makeActivityRow));if(!ui.records.length)$('home-activity').append(node('p','No activity yet.'));document.dispatchEvent(new Event('drivekey-records-changed'));
}
async function refreshActivity(){const identity=ui.public?.deviceId;if(!identity){ui.records=[];$('payment-history-state').textContent='Choose a wallet to view activity.';renderActivity();return;}const result=await api('listTransactions');if(identity!==ui.public?.deviceId)return;if(!result){$('payment-history-state').textContent='Activity unavailable. Keep this profile and retry.';return;}ui.records=result.slice().sort((a,b)=>String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||'')));$('payment-history-state').textContent=ui.records.length?'Select an item for exact terms and available actions.':'No activity yet.';renderActivity();}
for(const id of ['activity-search','activity-network','activity-state'])$(id).addEventListener('input',renderActivity);$('refresh-payments').onclick=refreshActivity;
async function openTransaction(id){const trigger=document.activeElement,identity=ui.public?.deviceId,result=await api('getTransaction',id);if(!result||identity!==ui.public?.deviceId)return;const dialog=$('transaction-dialog'),body=$('transaction-detail');body.replaceChildren(statusPill(result.state));
 const assetGroup = node('div', undefined, 'detail-assets');
 const reviewAssets = [result.review?.inputAsset || result.review?.tokenIn || result.review?.asset, result.review?.outputAsset || result.review?.tokenOut];
 for (const symbol of [...new Set(reviewAssets)]) {
  const icon = window.DriveKeyAssets?.icon(symbol);
  if (!icon) continue;
  const identity = node('span');
  identity.append(icon, node('strong', symbol));
  assetGroup.append(identity);
 }
 if (assetGroup.childElementCount) body.append(assetGroup);
 const meta=node('p','Created '+dateLabel(result.createdAt)+' · checked '+dateLabel(result.updatedAt));body.append(meta);if(result.handoffState)body.append(node('p',({'local-only':'No unsigned file handoff is recorded.','export-started':'A file handoff was attempted. The original request may already be signed.','exported':'The original request was exported. Preserve its response and history.','external-seen':'This request was imported from outside this profile.','legacy-unknown':'Earlier handoff history is unavailable. Preserve the original records.'}[result.handoffState]||'')));if(result.reason)body.append(node('p',result.reason,'callout warning'));if(result.sourceConfirmed&&!result.destinationConfirmed)body.append(node('p','Source confirmed. Destination delivery still needs confirmation.','callout warning'));const timeline=node('ol',undefined,'activity-timeline');const event=(label,time)=>{const row=node('li');row.append(node('strong',label),node('span',time?dateLabel(time):'Recorded in settlement evidence'));timeline.append(row);};if(result.createdAt)event('Request created',result.createdAt);if(result.signedAt)event('Response signed',result.signedAt);if(result.sourceConfirmed)event('Source confirmed');if(result.destinationConfirmed)event('Destination confirmed');event('Latest status: '+(statusLabels[result.state]||result.state),result.updatedAt);body.append(timeline);const terms=node('dl',undefined,'terms');buildTerms(result.review||{},terms);body.append(terms);if(result.transactionHash){body.append(node('h3','Transaction identifier'),node('code',result.transactionHash));}const actions=node('div',undefined,'actions');if(result.state==='signing-uncertain'){body.append(node('p','Signing outcome unknown. Recover the original response in Saved signatures. No new signature or submission is permitted.','callout warning'));actions.append(button('Open saved signatures',async()=>{dialog.close();goto('signatures');await refreshSignatures();}));}
 const act=(text,fn)=>actions.append(button(text,async()=>{const out=await fn();if(out){await refreshActivity();dialog.close();await openTransaction(id);}}));
 const expired=Number.isFinite(Date.parse(result.expiresAt))&&Date.now()>=Date.parse(result.expiresAt);if(expired&&['prepared','signed'].includes(result.state))body.append(node('p',result.state==='signed'?'Request expired. Its signature is preserved; check status before further action.':'Request expired. Review its handoff and signing history before preparing another request.','callout warning'));if(!ui.offline&&result.paymentWritable&&result.state==='signed'&&!expired)act('Submit approved transaction',()=>api('submitPayment',id));if(!ui.offline&&result.state==='signed'&&(expired||!result.paymentWritable))act('Check status',()=>api('reconcilePayment',id));
 if(!ui.offline&&['pending','submitting','uncertain','conflict','expired-unresolved','destination-pending'].includes(result.state))act('Check status',()=>api(result.canReconcileDestination?'reconcileLifiMayanDestination':'reconcilePayment',id));
 if(result.receiptAvailable)actions.append(button('Save receipt',async()=>{const r=await api('exportPaymentReceipt',id);if(r?.saved)notify('Receipt saved.');}));
 if(result.transactionHash&&!ui.watchOnly)actions.append(button('Export saved response',async()=>{const r=await api('exportSignature',id.replace(/^0x/,''));if(r?.saved)notify('Existing signed response exported.');}));
 if(result.paymentWritable&&result.state==='prepared'&&!ui.offline){if(!expired)actions.append(button('Review & export request',async()=>{dialog.close();await prepare('reviewSavedRequest',id);}));actions.append(button('Import signed response',async()=>{dialog.close();await importResponse();}));}if(result.canDiscard)actions.append(button('Discard local draft',async()=>{const result=await api('discardPreparedRequest',id);if(result?.discarded){dialog.close();clearReview();notify('Local draft discarded. Its original history is preserved. Prepare a new request for a fresh review.');await refreshActivity();}}));body.append(actions);if(!dialog.open)openDialog(dialog,trigger);}
$('close-transaction').onclick=()=>$('transaction-dialog').close();
function renderProductProofAmounts(){
 const hidden=document.body.dataset.hideBalances==='true';
 for(const value of document.querySelectorAll('[data-proof-amount]'))value.textContent=hidden?'••••':formatUnits(value.dataset.proofAmount,value.dataset.proofAsset)+' '+value.dataset.proofAsset;
}
new MutationObserver(renderProductProofAmounts).observe(document.body,{attributes:true,attributeFilter:['data-hide-balances']});
async function refreshProductProofs(){
 if(!ui.proofEnabled)return;
 const identity=ui.public?.deviceId,list=$('product-proof-list');list.replaceChildren();$('product-proof-recovery').hidden=false;
 if(!identity||ui.watchOnly){$('product-proof-recovery-state').textContent='Choose the local signing wallet to view proof authorizations.';return;}
 const rows=await api('listProductProofs');if(identity!==ui.public?.deviceId)return;
 if(!rows){$('product-proof-recovery-state').textContent='Proof recovery is unavailable. Preserve this profile.';return;}
 $('product-proof-recovery-state').textContent=rows.length?'Encrypted in this Windows profile. Exporting reuses the same authorization.':'No proof requests for this wallet.';
 for(const r of rows){
  const row=node('article',undefined,'signature-row'),copy=node('div');const amount=node('p');amount.dataset.proofAmount=r.amount;amount.dataset.proofAsset=r.asset;copy.append(node('strong',r.chain+' · '+r.action+' · '+(r.state==='signing-uncertain'?'Signing outcome unknown':r.state)),amount,node('code',r.id));row.append(copy);
  if(['authorized','proved'].includes(r.state)){
   row.append(button('Export proof authorization',async()=>{const result=await api('exportProductProof',r.id);if(result?.saved)notify('Existing proof authorization exported. No new signature was created.');}));
   if(r.state==='proved')row.append(button('Export existing proof',async()=>{const result=await api('exportProductProofResult',r.id);if(result?.saved)notify('Existing proof exported. Review the chain transaction separately.');}));
   else if(r.localProvingSupported){const generate=button('Generate private proof',()=>{clearReview();ui.proofToGenerate=r.id;$('product-prove-id').textContent=r.id;$('product-prove-form').hidden=false;$('product-prove-pass').focus();});generate.disabled=!ui.backupVerified;row.append(generate);}
  }
  else if(r.state==='signing-uncertain'){copy.append(node('p','Preserve this profile. New signing for this wallet is disabled.'));if(r.canRecoverOriginal)row.append(button('Recover original response',async()=>{const result=await api('recoverSigningResponse',r.id,'private-proof');if(result?.restored){notify(result.warning);await refreshProductProofs();}}));else copy.append(node('p','No original response commitment is available. Preserve all files.'));}
  else row.append(button('Review proof request',async()=>{const result=await api('reviewProductProof',r.id);if(result?.token)acceptPrepared(result,'proof-recovery');}));
  list.append(row);
 }
 renderProductProofAmounts();
}
$('import-product-proof-package').onclick=async()=>{clearReview();const revision=ui.revision,identity=ui.public?.deviceId;if(!identity||ui.offline)return;const result=await api('importProductProofPackage');if(revision!==ui.revision||identity!==ui.public?.deviceId){await api('invalidatePreparedReview');return;}if(result?.token){acceptPrepared(result,'product-proof-package');notify(result.reused?'Original unsigned private transaction reopened. Review it before signing.':'Private proof verified. Review this separate unsigned chain transaction.');}else if(result?.cancelled)notify('Proof package import canceled.');};
$('import-product-proof').onclick=async()=>{clearReview();if(!ui.public||ui.watchOnly){notify('Choose the local signing wallet first.',true);return;}const result=await api('importProductProof');if(result?.token)acceptPrepared(result,'proof-import');};
$('product-proof-history').onclick=async()=>{await refreshProductProofs();goto('signatures');};
$('product-prove-form').onsubmit=async e=>{
 e.preventDefault();if(!ui.proofToGenerate||!ui.backupVerified||ui.watchOnly)return;
 const id=ui.proofToGenerate,pass=$('product-prove-pass').value;$('product-prove-pass').value='';ui.proofToGenerate=null;$('product-prove-form').hidden=true;
 const result=await api('generateProductProof',id,pass);if(!result)return;
 if(result.cancelled){notify('Proof generation canceled. The authorization is preserved.');return;}
 if(result.proved){notify('Private proof verified and saved. A chain transaction still requires a separate review and signature.');await refreshProductProofs();}
};
$('product-prove-cancel').onclick=()=>{ui.proofToGenerate=null;$('product-prove-pass').value='';$('product-prove-form').hidden=true;};
async function refreshSignatures(){const identity=ui.public?.deviceId,list=$('signature-list');list.replaceChildren();if(!identity||ui.watchOnly){$('signature-recovery-state').textContent=ui.watchOnly?'Saved signatures belong to the local signing wallet.':'Choose a local wallet to view saved signatures.';return;}const rows=await api('listSignatures');if(identity!==ui.public?.deviceId)return;if(!rows){$('signature-recovery-state').textContent='Saved signatures unavailable. Preserve this profile and retry.';return;}$('signature-recovery-state').textContent=rows.length?'Encrypted in this Windows profile. Export does not create a new signature.':'No saved signatures for this wallet.';for(const r of rows){const row=node('article',undefined,'signature-row'),copy=node('div');row.dataset.signatureId=r.id;copy.append(node('strong',r.network),node('p',r.state==='signing-uncertain'?'Signing outcome unknown':dateLabel(r.signedAt)),node('code',r.warning||r.transactionHash||''));const exportButton=button('Export saved response',async()=>{const result=await api('exportSignature',r.id);if(result?.saved)notify('Existing signed response exported.');else if(result?.cancelled||result?.saved===false)notify('Export canceled. The saved response is preserved.');});exportButton.disabled=r.state==='signing-uncertain';row.append(copy,exportButton);if(r.state==='signing-uncertain'&&r.canRecoverOriginal)row.append(button('Recover original response',async()=>{const result=await api('recoverSigningResponse',r.id,'transaction');if(result?.restored){notify(result.warning);await refreshSignatures();}else if(result?.cancelled)notify('Recovery canceled. Original records are preserved.');}));list.append(row);}}
$('refresh-signatures').onclick=refreshSignatures;
const zoomLevels=[0.5,0.67,0.8,1,1.25,1.5,1.75,2];
let currentZoom=1;
function showZoom(result){if(!result||!zoomLevels.includes(result.zoom))return;currentZoom=result.zoom;$('interface-zoom').value=String(currentZoom);$('zoom-status').textContent='Interface size: '+Math.round(currentZoom*100)+'%. Applies to this window.';}
async function changeZoom(value){showZoom(await api('setInterfaceZoom',value));}
$('interface-zoom').onchange=event=>changeZoom(Number(event.target.value));
document.addEventListener('keydown',event=>{if(!event.ctrlKey||event.altKey||event.metaKey||!['+','=','-','0'].includes(event.key))return;event.preventDefault();const index=zoomLevels.indexOf(currentZoom);changeZoom(event.key==='0'?1:zoomLevels[Math.max(0,Math.min(zoomLevels.length-1,index+(event.key==='-'?-1:1)))]);});
$('configure-rpc').onclick=async()=>{const r=await api('configureRPC');if(r?.configured){clearReview();$('rpc-status').textContent='RPC configuration imported.';}else if(r?.cancelled)$('rpc-status').textContent='Configuration selection canceled.';};
async function loadUpdates(){if(ui.offline)return;const rows=await api('listUpdates');if(!rows)return;$('updates-list').replaceChildren(...rows.map(r=>{const b=button('',async()=>{await api('openWeb','article',r.id);});b.append(node('strong',r.title),node('small',r.date),node('small','Open website ↗'));return b;}));}
document.querySelectorAll('[data-reference]').forEach(b=>b.onclick=async()=>{await api('openWeb',b.dataset.reference,b.dataset.option);});
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement&&event.target.getAttribute('aria-hidden')==='true'){event.target.classList.add('broken-art');}},true);
window.DK=Object.freeze({call:api,context:()=>({...ui,public:ui.public?{...ui.public}:null}),prepare,acceptPrepared,notify,units,formatUnits,invalid,invalidate,view:goto});
(async()=>{if(!window.DriveKeyRoutes)await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));if(typeof window.DriveKeyRoutes?.init!=='function')throw Error('Route interface unavailable.');const mode=await api('applicationMode');if(!mode)throw Error('Application mode unavailable.');ui.offline=Boolean(mode.offline);ui.proofEnabled=mode.capabilities?.privateProofCreation===true;ui.productAdmissionEnabled=!ui.offline&&mode.capabilities?.productProofAdmission===true;document.querySelectorAll('[data-product-admission-ui]').forEach(e=>e.hidden=!ui.productAdmissionEnabled);document.querySelectorAll('[data-proof-ui]').forEach(e=>e.hidden=!ui.proofEnabled);document.body.dataset.offline=String(ui.offline);document.querySelectorAll('.online-only').forEach(e=>e.hidden=ui.offline);document.querySelectorAll('.offline-only').forEach(e=>e.hidden=!ui.offline);document.querySelectorAll('[data-view=swap],[data-view=private],.home-swap-panel').forEach(e=>e.hidden=true);$('mode-pill').textContent=ui.offline?'Offline companion':'Windows wallet';$('build-version').textContent=mode.version||'Unavailable';$('footer-version').textContent='Build '+(mode.version||'unknown');$('build-mode').textContent=ui.offline?'Offline companion · file exchange only':'Windows payments · ETH, SOL and USDC';if(ui.offline){document.querySelector('.nav-item[data-view=security] span').textContent='Backup & recovery';$('configure-rpc').disabled=true;}showZoom(await api('interfaceSettings'));await refreshWallets();await loadUpdates();goto(ui.offline?'review':'home',{focus:false});document.body.dataset.ready='true';})().catch(()=>{notify('Could not finish loading this workspace. Close and reopen the app.',true);document.body.dataset.ready='error';});
