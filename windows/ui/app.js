const $ = id => document.getElementById(id);
let currentWatchOnly=false;
let currentPublic, backupVerified=false, reviewToken, currentReview,receiveEpoch=0;
let wallets=[],activeWalletId=null,activeWalletName='',walletEditor=null;
let walletRecoveryRequired=false,walletCanRecover=false,walletRecoveryError='';
const shortAddress=value=>value?value.slice(0,6)+'…'+value.slice(-5):'—';
function walletIcon(symbol){const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');icon.classList.add('icon');use.setAttribute('href','#i-'+symbol);icon.append(use);return icon;}
function walletButton(text,action,handler,className=''){const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.walletAction=action;button.className=className;button.onclick=handler;return button;}
function applyWalletList(result){
  if(result&&Object.hasOwn(result,'recoveryRequired')){
    walletRecoveryRequired=Boolean(result.recoveryRequired);walletCanRecover=Boolean(result.canRecover);
    walletRecoveryError=result.error||'Saved wallet list could not be opened. Vault files are unchanged.';
  }
  if(Array.isArray(result?.wallets))wallets=result.wallets;
  if(result&&Object.hasOwn(result,'activeId'))activeWalletId=result.activeId;
  const active=wallets.find(wallet=>wallet.id===activeWalletId);
  activeWalletName=active?.name||'';
  if(currentPublic&&active)backupVerified=Boolean(active.backupVerified);
  renderWalletList();updateStatus();
}
async function refreshWallets(){
  try{const response=await window.drivekey.listWallets();if(!response.ok)throw Error(response.error);applyWalletList(response.result);return !walletRecoveryRequired;}catch(error){walletRecoveryRequired=true;walletCanRecover=false;walletRecoveryError=error.message||'Could not load saved wallets.';renderWalletList();updateStatus();return false;}
}
function renderWalletList(){
  const list=$('wallet-list');if(!list)return;list.replaceChildren();
  $('wallet-recovery').hidden=!walletRecoveryRequired;$('wallet-recovery-title').textContent=walletCanRecover?'Recover your wallet list':'Wallet list unavailable';$('wallet-recovery-message').textContent=walletRecoveryError;
  $('wallet-recovery-note').textContent=walletCanRecover?'The existing list will be kept as a recovery copy. Then reopen your encrypted vaults.':'Check that local storage is available, then retry.';
  $('recover-wallet-list').textContent=walletCanRecover?'Recover wallet list':'Retry wallet list';
  $('wallet-manager').querySelector('.wallet-manager-actions').hidden=walletRecoveryRequired;
  $('wallet-manager').querySelector('.wallet-manager-footer').hidden=walletRecoveryRequired;
  list.hidden=walletRecoveryRequired;
  for(const id of ['start','open-home','new-wallet','add-wallet-file','open-vault'])$(id).disabled=walletRecoveryRequired;
  if(walletRecoveryRequired){$('wallet-count').textContent='—';$('overview-wallet-count').textContent='Wallet list needs attention';$('wallet-search-row').hidden=true;$('wallet-list-empty').hidden=true;$('wallet-search-empty').hidden=true;showCreatePanel(false);return;}
  if(wallets.length<2)$('wallet-search').value='';
  const query=$('wallet-search').value.trim().toLocaleLowerCase();
  const shown=wallets.filter(wallet=>[wallet.name,wallet.evmAddress,wallet.solanaAddress].some(value=>String(value||'').toLocaleLowerCase().includes(query)));
  $('wallet-count').textContent=String(wallets.length);$('overview-wallet-count').textContent=wallets.length+' '+(wallets.length===1?'wallet':'wallets');
  $('wallet-search-row').hidden=wallets.length<2;$('wallet-list-empty').hidden=wallets.length>0;$('wallet-search-empty').hidden=!wallets.length||shown.length>0;
  for(const [index,wallet]of shown.entries()){
    const row=document.createElement('article'),avatar=document.createElement('span'),copy=document.createElement('div'),heading=document.createElement('div'),name=document.createElement('strong'),addresses=document.createElement('div'),actions=document.createElement('div');
    row.className='wallet-row'+(wallet.id===activeWalletId?' is-active':'');row.dataset.walletId=wallet.id;avatar.className='wallet-avatar tone-'+index%4;avatar.append(walletIcon('vault'));copy.className='wallet-row-copy';heading.className='wallet-row-heading';name.textContent=wallet.name;name.title=wallet.name;heading.append(name);
    if(wallet.id===activeWalletId){const badge=document.createElement('span');badge.className='wallet-active-badge';badge.textContent='Active';heading.append(badge);}
    addresses.className='wallet-addresses';
    for(const [network,source,address]of [['Ethereum','assets/chain-ethereum.svg',wallet.evmAddress],['Solana','assets/solana.png',wallet.solanaAddress]]){const item=document.createElement('span'),image=document.createElement('img'),code=document.createElement('code');image.src=source;image.alt=network;code.textContent=shortAddress(address);code.title=address;code.setAttribute('aria-label',network+' address '+address);item.append(image,code);addresses.append(item);}
    const status=document.createElement('span');status.className='wallet-backup-status'+(wallet.backupVerified?' verified':'');status.append(walletIcon(wallet.watchOnly?'eye-off':wallet.backupVerified?'check':'backup'),document.createTextNode(wallet.watchOnly?'Watch only':wallet.backupVerified?'Backup verified':'Verify backup'));copy.append(heading,addresses,status);
    actions.className='wallet-row-actions';const activate=walletButton(wallet.id===activeWalletId?'Selected':'Use wallet','activate',async()=>{const result=await call('activateWallet',wallet.id);if(result)setVault(result);},wallet.id===activeWalletId?'wallet-selected':'wallet-use');activate.disabled=wallet.id===activeWalletId;actions.append(activate);
    const extras=document.createElement('div');extras.className='wallet-secondary-actions';extras.append(walletButton('Rename','rename',()=>{walletEditor={id:wallet.id,mode:'rename'};renderWalletList();requestAnimationFrame(()=>list.querySelector('[data-wallet-name]')?.focus());}),walletButton('Remove','remove',()=>{walletEditor={id:wallet.id,mode:'remove'};renderWalletList();}));actions.append(extras);row.append(avatar,copy,actions);
    if(walletEditor?.id===wallet.id){
      const editor=document.createElement(walletEditor.mode==='rename'?'form':'div');editor.className='wallet-inline-editor';
      if(walletEditor.mode==='rename'){
        const label=document.createElement('label'),input=document.createElement('input'),buttons=document.createElement('div');input.type='text';input.value=wallet.name;input.maxLength=40;input.minLength=1;input.required=true;input.autocomplete='off';input.dataset.walletName='';label.textContent='Wallet name';label.append(input);buttons.className='wallet-editor-actions';
        const save=walletButton('Save name','save-name',null,'primary');save.type='submit';buttons.append(save,walletButton('Cancel','cancel-edit',()=>{walletEditor=null;renderWalletList();}));editor.append(label,buttons);editor.onsubmit=async event=>{event.preventDefault();const result=await call('renameWallet',wallet.id,input.value);if(result){walletEditor=null;applyWalletList(result);toast('Wallet renamed.');}};
      }else{
        const warning=document.createElement('div'),title=document.createElement('strong'),note=document.createElement('span'),buttons=document.createElement('div');title.textContent='Remove '+wallet.name+' from this app?';note.textContent='Your vault and backup files stay on disk.';warning.append(title,note);buttons.className='wallet-editor-actions';buttons.append(walletButton('Remove from app','confirm-remove',async()=>{const result=await call('removeWallet',wallet.id);if(!result)return;walletEditor=null;if(result.cleared)clearActiveDisplay();applyWalletList(result);showCreatePanel(!wallets.length);toast('Wallet removed from this app. Files kept.');},'wallet-remove-confirm'),walletButton('Cancel','cancel-edit',()=>{walletEditor=null;renderWalletList();}));editor.append(warning,buttons);
      }
      row.append(editor);
    }
    list.append(row);
  }
  $('active-wallet-name').textContent=activeWalletName||'Wallet';$('active-wallet-name').title=activeWalletName;
}
function showCreatePanel(show){const visible=Boolean(show)&&!walletRecoveryRequired;$('vault-empty').hidden=!visible;$('wallet-create-heading').hidden=!visible;$('cancel-new-wallet').hidden=!wallets.length;}
function clearActiveDisplay(){
  if($('amount-qr')){$('amount-qr').hidden=true;$('qr-uri').textContent='';$('qr-context').textContent='';$('balance-display').textContent='';}if($('payment-history')){$('payment-history').replaceChildren();$('payment-history-state').textContent='Choose a wallet, then refresh.';}signatureEpoch++;$('signature-list').replaceChildren();$('signature-recovery-state').textContent='Choose a wallet to view saved signatures.';receiveEpoch++;currentWatchOnly=false;currentPublic=undefined;backupVerified=false;activeWalletId=null;activeWalletName='';clearReceive();document.querySelectorAll('input[type=password]').forEach(input=>input.value='');
  for(const id of ['evm','sol','device'])$(id).textContent='';$('vault-loaded').hidden=true;resetReview();
}
const swapProviders=Object.freeze({
  lifi:{name:'LI.FI',image:'assets/provider-lifi.svg',route:'ETH → USDC',chains:[{id:'ethereum',name:'Ethereum',image:'assets/chain-ethereum.svg'}]},
  jupiter:{name:'Jupiter',image:'assets/provider-jupiter.png',route:'SOL ↔ USDC',chains:[{id:'solana',name:'Solana',image:'assets/solana.png'}]},
  direct:{name:'Uniswap',image:'assets/provider-uniswap.svg',route:'WETH ↔ USDC',chains:[{id:'ethereum',name:'Ethereum',image:'assets/chain-ethereum.svg'}]},
  husher:{name:'Husher',image:'assets/provider-husher.png',route:'ETH → USDC',chains:[{id:'ethereum',name:'Ethereum',image:'assets/chain-ethereum.svg'}]}
});
let swapChain='';
function selectSwapChain(id){
  const provider=swapProviders[$('swap-provider').value],chain=provider?.chains.find(item=>item.id===id);
  if(!chain)return;
  swapChain=id;document.querySelectorAll('[data-chain]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chain===id)));
  $('swap-heading').textContent='Your route is ready.';$('swap-chain-hint').textContent='Selected';
  $('swap-route-label').textContent=provider.route;$('swap-route-network').textContent=chain.name;$('swap-route-summary').hidden=false;
  $('swap-status').textContent='Review quotes and confirm '+chain.name+' in the dapp.';
  document.querySelector('[data-web-route="swap"]').disabled=false;
}
function selectSwapProvider(key){
  const provider=swapProviders[key];if(!provider)return;
  if($('swap-provider').value===key)return;
  $('swap-provider').value=key;swapChain='';
  document.querySelectorAll('[data-provider]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.provider===key)));
  $('swap-heading').textContent='Choose your chain.';$('swap-chain-hint').textContent='Available for '+provider.name;
  $('swap-provider-image').src=provider.image;$('swap-provider-image').alt=provider.name+' logo';$('swap-provider-name').textContent=provider.name;$('swap-selected-provider').hidden=false;
  $('swap-network-empty').hidden=true;$('swap-chains').hidden=false;$('swap-chains').replaceChildren();$('swap-route-summary').hidden=true;
  $('swap-status').textContent='Select a chain to continue.';document.querySelector('[data-web-route="swap"]').disabled=true;
  for(const chain of provider.chains){
    const button=document.createElement('button'),image=document.createElement('img'),copy=document.createElement('span'),name=document.createElement('strong'),label=document.createElement('small'),indicator=document.createElement('span');
    button.type='button';button.className='swap-chain-card';button.dataset.chain=chain.id;button.setAttribute('aria-pressed','false');image.src=chain.image;image.alt=chain.name+' logo';name.textContent=chain.name;label.textContent='Mainnet';copy.append(name,label);indicator.className='chain-radio';indicator.setAttribute('aria-hidden','true');button.append(image,copy,indicator);button.onclick=()=>selectSwapChain(chain.id);$('swap-chains').append(button);
  }
}
document.querySelectorAll('[data-provider]').forEach(button=>button.addEventListener('click',()=>selectSwapProvider(button.dataset.provider)));
function updateStatus(){
  const set=(id,value)=>{if($(id))$(id).textContent=value;};
  set('status-vault',walletRecoveryRequired?'Wallet list unavailable':currentPublic?activeWalletName||'Wallet selected':'None selected');
  set('status-backup',backupVerified?'Backup verified':'Not verified');
  set('status-signing',walletRecoveryRequired?'Open Wallets':currentWatchOnly?'Signing stays offline':backupVerified?'Ready for review':currentPublic?'Verify your backup':'Choose a wallet');
  set('vault-pill',walletRecoveryRequired?'Wallet list needs attention':currentPublic?activeWalletName||'Wallet selected':'Choose a wallet');
  $('status-vault').title=activeWalletName;$('vault-pill').title=walletRecoveryRequired?'Wallet list needs attention':activeWalletName;
  for(const [id,complete]of [['setup-step-1',!!currentPublic],['setup-step-2',backupVerified],['setup-step-3',!!currentReview]])if($(id))$(id).classList.toggle('is-complete',complete);
}
function view(name){document.querySelectorAll('[data-page]').forEach(s=>s.hidden=s.dataset.page!==name);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('breadcrumb').textContent=({home:'Overview',payments:'Payments',requests:'Request payment',vault:'Wallets',review:'Review & sign',receive:'Deposit',swap:'Swap',private:'Hinkal',savings:'Savings'}[name]||'Overview');updateStatus();if(name==='payments')refreshPayments();if(name==='receive')renderReceive();if(name==='review')refreshSignatures();window.scrollTo({top:0,behavior:'instant'});}
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
async function call(method,...args){$('working').hidden=false;try{const response=await window.drivekey[method](...args);if(!response.ok)throw Error(response.error);return response.result;}catch(e){toast(e.message,true);return null;}finally{$('working').hidden=true;}}
function resetReview(){reviewToken=undefined;currentReview=undefined;$('review-loaded').hidden=true;$('signed').hidden=true;$('review-empty').hidden=false;$('review-status').textContent='No request loaded';$('terms').replaceChildren();$('sign-pass').value='';$('approval').checked=false;updateStatus();}
function setVault(result){if(!result||result.cancelled||!result.public)return;clearActiveDisplay();currentPublic=result.public;currentWatchOnly=Boolean(result.watchOnly);for(const s of ['.backup-export','.backup-check','.vault-next'])document.querySelector(s).hidden=currentWatchOnly;backupVerified=Boolean(result.backupVerified);activeWalletId=result.wallet?.id||result.activeId||null;activeWalletName=result.wallet?.name||'Wallet';walletEditor=null;$('wallet-search').value='';applyWalletList(result);showCreatePanel(false);$('vault-loaded').hidden=false;$('evm').textContent=currentPublic.evmAddress;$('sol').textContent=currentPublic.solanaAddress;$('device').textContent=currentPublic.deviceId;$('backup-state').textContent=backupVerified?'Backup verified':'Verification needed';$('backup-state').className=backupVerified?'pill':'pill amber';$('new-wallet-name').value='';view('vault');toast(currentWatchOnly?activeWalletName+' selected. Watch only.':backupVerified?activeWalletName+' selected.':activeWalletName+' selected. Verify its backup.');}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.jump)));
document.querySelectorAll('[data-web-route]').forEach(b=>b.addEventListener('click',async()=>{
  const route=b.dataset.webRoute;
  if(route==='swap'&&!swapProviders[$('swap-provider').value]?.chains.some(chain=>chain.id===swapChain)){toast('Choose a provider and chain first.',true);return;}
  const option=route==='swap'?$('swap-provider')?.value:route==='savings'?document.querySelector('input[name="protection-mode"]:checked')?.value:undefined;
  const result=await call('openWeb',route,option);if(result?.opened)toast(result.hint);
}));
$('start').onclick=()=>{view('vault');showCreatePanel(true);};$('go-review').onclick=()=>view('review');
for(const id of ['open-home','open-vault','add-wallet-file'])$(id).onclick=async()=>setVault(await call('loadVault'));
for(const id of ['switch-vault','wallet-selector','manage-wallets'])$(id).onclick=()=>{view('vault');$('wallet-manager').scrollIntoView({block:'start'});};
$('new-wallet').onclick=()=>{showCreatePanel(true);$('new-wallet-name').value='';$('new-wallet-name').focus();};
$('cancel-new-wallet').onclick=()=>{showCreatePanel(false);document.querySelectorAll('#create-form input').forEach(input=>input.value='');};
$('wallet-search').oninput=renderWalletList;
$('recover-wallet-list').onclick=async()=>{
  if(!walletCanRecover){await refreshWallets();showCreatePanel(!wallets.length);return;}
  const result=await call('recoverWalletList');if(!result)return;
  if(result.recovered){clearActiveDisplay();walletEditor=null;}
  applyWalletList(result);showCreatePanel(!wallets.length);
  if(result.recovered)toast('Wallet list recovered. Reopen your encrypted vault files.');
};
$('create-form').onsubmit=async e=>{e.preventDefault();const pass=$('new-pass').value,confirm=$('confirm-pass').value,name=$('new-wallet-name').value;$('new-pass').value='';$('confirm-pass').value='';setVault(await call('createVault',pass,confirm,name.trim()?name:undefined));};
$('public').onclick=async()=>{const r=await call('exportPublic');if(r?.saved)toast('Public wallet saved. Import it in the DriveKey dapp.');};
$('backup').onclick=async()=>{const r=await call('exportBackup');if(r?.saved)toast('Encrypted backup saved. Verify it below before signing.');};
$('backup-form').onsubmit=async e=>{e.preventDefault();const pass=$('backup-pass').value;$('backup-pass').value='';const r=await call('verifyBackup',pass);if(r?.verified){backupVerified=true;$('backup-state').textContent='Backup verified';$('backup-state').className='pill';if(r.wallets)applyWalletList(r);else await refreshWallets();updateStatus();toast('Backup reopened and passphrase verified.');}};
function renderReview(review){
  const labels={action:'Action',network:'Network',from:'From',recipient:'Recipient',asset:'Asset',tokenContract:'Token contract',amount:'Amount',baseUnits:'Amount in base units',maximumFee:'Maximum fee',deadlineUTC:'Deadline (UTC)',fingerprint:'Fingerprint',requestId:'Request ID',deviceId:'Device identity',warning:'Review note',transactionTarget:'Transaction target',nonce:'Nonce',maximumFeeBaseUnits:'Fee in base units',chainStateWarning:'Network state',tokenCodeHash:'Token code hash',implementation:'Implementation address',implementationCodeHash:'Implementation code hash',nonceAccount:'Nonce account',nonceValue:'Nonce value',genesisHash:'Network genesis hash',recipientAccountRent:'Recipient account rent',createRecipientAccount:'Create recipient account',decimals:'Token decimals'};
  const order=['amount','network','recipient','from','maximumFee','deadlineUTC','fingerprint','action','asset','tokenContract','transactionTarget','nonce','baseUnits','maximumFeeBaseUnits','requestId','deviceId','warning'];
  const rank=key=>order.includes(key)?order.indexOf(key):order.length;
  const entries=Object.entries(review).filter(([key])=>key!=='trustModel').sort(([a],[b])=>rank(a)-rank(b));
  for(const [key,value]of entries){const row=document.createElement('div'),term=document.createElement('dt'),detail=document.createElement('dd');row.dataset.field=key;if(key==='amount')row.className='primary-term';term.textContent=labels[key]||key.replace(/([a-z])([A-Z])/g,'$1 $2');detail.textContent=typeof value==='object'?JSON.stringify(value,null,2):String(value);row.append(term,detail);$('terms').append(row);}
}
$('import').onclick=async()=>{resetReview();if(!currentPublic){toast('Create or open a vault first.',true);view('vault');return;}const r=await call('importRequest');if(!r||r.cancelled)return;reviewToken=r.token;currentReview=r.review;renderReview(r.review);$('review-empty').hidden=true;$('review-loaded').hidden=false;$('review-status').textContent='Ready for your review';updateStatus();};
$('sign-form').onsubmit=async e=>{e.preventDefault();if(!backupVerified){toast('Verify a separate encrypted backup before signing.',true);view('vault');return;}if(!reviewToken||!currentReview)return;const pass=$('sign-pass').value;$('sign-pass').value='';const token=reviewToken,fingerprint=currentReview.fingerprint;const r=await call('sign',token,fingerprint,pass);resetReview();if(!r)return;if(r.cancelled){toast('Approval cancelled. Import the request again to review it.');return;}$('review-empty').hidden=true;$('signed').hidden=false;$('review-status').textContent=r.saved?'Signed response exported':'Export cancelled';$('signed-title').textContent=r.saved?'Return to the dapp':'Signature export cancelled';$('signed-message').textContent=r.warning;$('tx-hash').textContent=r.transactionHash||'';refreshSignatures();};
$('next-review').onclick=resetReview;
$('lock').onclick=async()=>{const result=await call('clear');if(result){clearActiveDisplay();walletEditor=null;if(result.wallets)applyWalletList(result);else await refreshWallets();showCreatePanel(!wallets.length);view('home');toast('Session cleared. Saved wallets kept.');}};
function clearReceive(){if($('receive-address'))$('receive-address').textContent='—';if($('receive-qr')){$('receive-qr').hidden=true;$('receive-qr').removeAttribute('src');}if($('copy-address'))$('copy-address').disabled=true;if($('receive-notice'))$('receive-notice').textContent='Open a wallet to receive.';}
async function renderReceive(){
  const epoch=++receiveEpoch;clearReceive();if(!currentPublic||!$('receive-network'))return;
  const response=await window.drivekey.receiveInfo($('receive-network').value);
  if(epoch!==receiveEpoch||!currentPublic)return;
  if(!response.ok){$('receive-notice').textContent=response.error;return;}
  const info=response.result;$('receive-address').textContent=info.address;$('receive-qr').src=info.qr;$('receive-qr').hidden=false;$('copy-address').disabled=false;$('receive-notice').textContent='Receive '+info.asset+' on '+info.network+'.';
}
if($('receive-network'))$('receive-network').addEventListener('change',renderReceive);
if($('copy-address'))$('copy-address').onclick=async()=>{const result=await call('copyAddress',$('receive-network').value);if(result?.copied)toast(result.network+' address copied.');};
async function loadUpdates(){
  const response=await window.drivekey.listUpdates();if(!response.ok||!$('updates-list'))return;
  for(const post of response.result){const card=document.createElement('button');card.className='update-card';card.dataset.articleId=post.id;const date=document.createElement('time'),title=document.createElement('strong'),summary=document.createElement('span'),link=document.createElement('small');date.textContent=post.date;date.dateTime=post.isoDate;title.textContent=post.title;summary.textContent=post.summary;link.textContent='Read on X ↗';card.append(date,title,summary,link);card.onclick=async()=>{const result=await call('openWeb','article',post.id);if(result?.opened)toast(result.hint);};$('updates-list').append(card);}
}
(async()=>{const mode=await window.drivekey.applicationMode();if(mode.ok&&mode.result.offline){document.body.dataset.offline='true';document.querySelector('.mode-line span').textContent='Offline companion · File exchange only · Disconnect this computer from networks before signing.';for(const id of ['configure-rpc','payment-balance','import-watch'])$(id).disabled=true;$('payment-form').querySelector('button[type=submit]').disabled=true;document.querySelectorAll('[data-web-route],[data-article-id]').forEach(b=>b.disabled=true);}await refreshWallets();showCreatePanel(!wallets.length);await loadUpdates();updateStatus();document.body.dataset.ready='true';})().catch(error=>toast(error.message||'Could not finish loading the workspace.',true));

let signatureEpoch=0;
async function refreshSignatures(){
 const epoch=++signatureEpoch;$('signature-list').replaceChildren();if(!currentPublic){$('signature-recovery-state').textContent='Choose a wallet to view saved signatures.';return;}
 const records=await call('listSignatures');if(epoch!==signatureEpoch)return;
 if(!records){$('signature-recovery-state').textContent='Saved signatures could not be opened. Keep this profile and retry.';return;}
 $('signature-recovery-state').textContent=records.length?'Encrypted in this Windows profile. Verify in the dapp before submitting.':'No saved signatures for this wallet.';
 for(const record of records){const row=document.createElement('div'),copy=document.createElement('div'),title=document.createElement('strong'),time=document.createElement('small'),hash=document.createElement('code'),button=document.createElement('button');row.className='signature-row';row.dataset.signatureId=record.id;title.textContent=record.network;time.textContent=record.uncertain?'Signing outcome unknown':record.signedAt||'';hash.textContent=record.warning||record.transactionHash||'';button.textContent='Export saved response';if(record.state==='signing-uncertain'){time.textContent='Signing outcome unknown';button.disabled=true;}button.onclick=async()=>{const result=await call('exportSignature',record.id);if(result?.saved)toast('Saved signature exported. Verify it in the dapp.');};copy.append(title,time,hash);row.append(copy,button);if(record.state==='signing-uncertain'&&record.canRecoverOriginal){const recover=document.createElement('button');recover.textContent='Recover original response';recover.onclick=async()=>{const result=await call('recoverSigningResponse',record.id,'transaction');if(result?.restored){toast(result.warning);refreshSignatures();}};row.append(recover);}$('signature-list').append(row);}
}
$('refresh-signatures').onclick=refreshSignatures;

$('configure-rpc').onclick=async()=>{const r=await call('configureRPC');if(r?.configured){resetReview();toast('RPC configuration imported.');}};
$('payment-chain').onchange=()=>{const sol=['solana','devnet'].includes($('payment-chain').value);$('payment-asset').replaceChildren(...[sol?'SOL':'ETH','USDC'].map(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;return o;}));resetReview();};
$('payment-form').onsubmit=async e=>{e.preventDefault();resetReview();let parsed;try{parsed=toBaseUnits($('payment-amount').value,$('payment-asset').value);}catch(e){toast(e.message,true);return;}const r=await call('preparePayment',{chain:$('payment-chain').value,asset:$('payment-asset').value,recipient:$('payment-recipient').value.trim(),amount:parsed});if(!r)return;reviewToken=r.token;currentReview=r.review;renderReview(r.review);$('review-empty').hidden=true;$('review-loaded').hidden=false;$('review-status').textContent='Ready for your review';view('review');};
$('export-payment').onclick=async()=>{const r=await call('exportPaymentRequest');if(r?.saved)toast('Request exported. Review it on the offline companion.');};
$('import-payment').onclick=async()=>{const r=await call('importPaymentResponse');if(r?.imported){toast('Signature verified against the prepared intent.');await refreshPayments();}};
async function refreshPayments(){const identity=currentPublic?.deviceId;$('payment-history').replaceChildren();if(!identity){$('payment-history-state').textContent='Choose a wallet to view payments.';return;}const rows=await call('listTransactions');if(identity!==currentPublic?.deviceId)return;if(!rows){$('payment-history-state').textContent='History unavailable. Preserve the Windows profile and retry.';return;}$('payment-history-state').textContent=rows.length?'Signatures are saved before submission. Uncertain submissions require reconciliation.':'No payments for this wallet.';for(const r of rows){const row=document.createElement('article'),text=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('code'),state=document.createElement('p'),button=document.createElement('button');row.className='payment-row';title.textContent=fromBaseUnits(r.amount,r.asset)+' '+r.asset+' · '+r.network;detail.textContent=r.recipient;state.textContent=r.state+(r.reason?' · '+r.reason:'');text.append(title,detail,state);button.textContent=r.state==='signed'?'Submit approved payment':'Reconcile settlement';button.disabled=r.state==='prepared'||document.body.dataset.offline==='true';button.onclick=async()=>{await call(r.state==='signed'?'submitPayment':'reconcilePayment',r.id);await refreshPayments();};row.append(text,button);if(r.state==='confirmed'){const receipt=document.createElement('button');receipt.textContent='Save receipt';receipt.onclick=async()=>{const out=await call('exportPaymentReceipt',r.id);if(out?.saved)toast('Finalized receipt saved.');};row.append(receipt);}$('payment-history').append(row);}}
$('refresh-payments').onclick=refreshPayments;

$('import-watch').onclick=async()=>{const r=await call('importWatchWallet');if(r?.public){setVault(r);toast('Watch-only wallet selected. Signing stays on the offline computer.');}};

function assetDecimals(asset){return asset==='USDC'?6:asset==='SOL'?9:18;}
function toBaseUnits(value,asset){const d=assetDecimals(asset);if(!/^[0-9]+(?:\.[0-9]+)?$/.test(value))throw Error('Enter a positive decimal amount.');const [whole,fraction='']=value.split('.');if(fraction.length>d)throw Error('Too many decimal places for '+asset+'.');const units=BigInt(whole+fraction.padEnd(d,'0'));if(units<=0n||units.toString().length>38)throw Error('Amount is outside the supported range.');return units.toString();}
function fromBaseUnits(value,asset){const d=assetDecimals(asset),s=String(value).padStart(d+1,'0');return (s.slice(0,-d)+'.'+s.slice(-d)).replace(/\.?0+$/,'');}
$('payment-balance').onclick=async()=>{const identity=currentPublic?.deviceId,chain=$('payment-chain').value,asset=$('payment-asset').value;const r=await call('paymentBalance',{chain,asset});if(r&&identity===currentPublic?.deviceId&&chain===$('payment-chain').value&&asset===$('payment-asset').value)$('balance-display').textContent=fromBaseUnits(r.amount,asset)+' '+asset;};
$('qr-chain').onchange=()=>{$('qr-asset').replaceChildren(...[['solana','devnet'].includes($('qr-chain').value)?'SOL':'ETH','USDC'].map(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;return o;}));$('amount-qr').hidden=true;$('qr-uri').textContent='';};
$('qr-form').onsubmit=async e=>{e.preventDefault();let amount;try{amount=toBaseUnits($('qr-amount').value,$('qr-asset').value);}catch(e){toast(e.message,true);return;}const r=await call('paymentQR',{chain:$('qr-chain').value,asset:$('qr-asset').value,amount});if(r){$('amount-qr').src=r.qr;$('amount-qr').hidden=false;$('qr-uri').textContent=r.uri;$('qr-context').textContent=fromBaseUnits(r.amount,r.asset)+' '+r.asset+' on '+r.chain;}};
