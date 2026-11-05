'use strict';
(()=>{
 const q=id=>document.getElementById(id),make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 function boot(){if(document.body.dataset.ready!=='true'){setTimeout(boot,30);return;}
  const page=document.querySelector('[data-page=settings]'),heading=page.querySelector('.page-heading');heading.querySelector('h1').textContent='Settings';
  const oldSplit=page.querySelector('.split'),network=oldSplit.children[0],about=oldSplit.children[1],extra=[...page.children].filter(e=>e!==heading&&e!==oldSplit);
  const tabs=make('div',null,'settings-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Settings');
  const panels={};for(const name of ['General','Accounts','Security','About','Help']){const key=name.toLowerCase(),button=make('button',name);button.type='button';button.id='settings-tab-'+key;button.setAttribute('role','tab');button.setAttribute('aria-controls','settings-panel-'+key);const panel=make('section',null,'settings-panel');panel.id='settings-panel-'+key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.hidden=key!=='general';button.setAttribute('aria-selected',String(!panel.hidden));button.tabIndex=panel.hidden?-1:0;button.onclick=()=>select(key);tabs.append(button);panels[key]=panel;}
  function select(key){for(const [k,p]of Object.entries(panels)){p.hidden=k!==key;const b=q('settings-tab-'+k);b.setAttribute('aria-selected',String(k===key));b.tabIndex=k===key?0:-1;}}
  tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...tabs.children],i=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length;buttons[next].click();buttons[next].focus();});
  function group(panel,title,description){
   const section=make('section',null,'settings-group');
   const heading=make('header',null,'settings-group-heading');
   heading.append(make('h2',title),make('p',description));
   const body=make('div',null,'settings-group-body');section.append(heading,body);
   panels[panel].append(section);return body;
  }
  function row(parent,title,description,control){
   const r=make('div',null,'setting-row'),copy=make('div',null,'setting-copy');
   copy.append(make('h3',title),make('p',description));
   const action=make('div',null,'setting-control');action.append(control);
   r.append(copy,action);parent.append(r);return r;
  }
  const appearance=group('general','Appearance','Make this workspace comfortable to use.');
  const zoomControl=make('div',null,'setting-field');
  const zoom=q('interface-zoom'),zoomLabel=zoom.previousElementSibling;
  zoomLabel.classList.add('sr-only');
  const zoomChoice=zoom.nextElementSibling?.classList.contains('dk-choice')?zoom.nextElementSibling:null;
  zoomControl.append(zoomLabel,zoom);if(zoomChoice)zoomControl.append(zoomChoice);zoomControl.append(q('zoom-status'));
  row(appearance,'Interface size','Adjust text and controls together. Use Ctrl + plus, minus or 0.',zoomControl);
  const currencyLabel=make('label','Display currency'),currency=make('select');
  currencyLabel.className='setting-field';currency.id='settings-currency';
  for(const value of ['usd','eur','pln']){const option=make('option',value.toUpperCase());option.value=value;currency.append(option);}
  currency.value=q('display-currency').value;
  currency.onchange=()=>{q('display-currency').value=currency.value;q('display-currency').dispatchEvent(new Event('change',{bubbles:true}));};
  q('display-currency').addEventListener('change',()=>currency.value=q('display-currency').value);
  currencyLabel.append(currency);row(appearance,'Display currency','Used for prices and estimated portfolio values.',currencyLabel);
  const connections=group('general','Network','Manage the connections used for public blockchain reads.');
  const rpcControl=make('div',null,'setting-field');rpcControl.append(q('configure-rpc'),q('rpc-status'));
  const rpcRow=row(connections,'RPC endpoints','Import HTTPS endpoints for your networks. Localhost is supported for testing.',rpcControl);
  const offlineNote=network.querySelector('.offline-only');if(offlineNote)rpcRow.querySelector('.setting-copy').append(offlineNote);
  const rpcDetails=network.querySelector('details');rpcDetails.classList.add('settings-disclosure');connections.append(rpcDetails);
  const session=group('general','Session','Choose when to clear the current wallet selection.');
  row(session,'Clear session','Saved encrypted vault files stay on this computer.',q('settings-clear'));
  const accountsGroup=group('accounts','Wallet accounts','Manage the wallets available on this computer.');
  const accounts=make('button','Open accounts');accounts.onclick=()=>window.DK.view('vault');
  row(accountsGroup,'Your accounts','Create, open and manage encrypted or public wallets.',accounts);
  const securityGroup=group('security','Security and recovery','Review wallet protection before approving a request.');
  const security=make('button','Open security & backup');security.onclick=()=>window.DK.view('security');
  row(securityGroup,'Backups and approvals','Check the current wallet, backup status and signing controls.',security);
  const buildGroup=group('about','This application','Local build details and release availability.');
  const facts=about.querySelector('.terms');facts.classList.add('settings-build-facts');buildGroup.append(facts);
  buildGroup.append(make('p','Engineering build for interface verification and local testing.','settings-note'));
  const update=make('p','No trusted release channel is configured.','settings-update-status');
  row(buildGroup,'App updates','Update installation needs a signed release channel.',update);
  const helpGroup=group('help','Help and references','Project news and external provider resources.');
  for(const n of extra){n.classList.add('settings-resource');helpGroup.append(n);}
  oldSplit.remove();page.append(tabs,...Object.values(panels));q('app-update-state').addEventListener('click',()=>select('about'));
  const form=q('trade-form'),send=make('section',null,'swap-amount-card swap-send-card'),receive=make('section',null,'swap-amount-card swap-receive-card'),advanced=make('details',null,'swap-advanced'),summary=make('summary','Route and limits');
  const label=id=>q(id).closest('label'),mode=label('trade-mode'),chain=label('trade-chain'),from=label('trade-token-in'),amount=label('trade-amount'),provider=label('trade-provider'),operation=label('trade-operation'),recipient=label('trade-recipient'),slippage=label('trade-slippage'),pool=label('trade-pool-fee'),actions=q('trade-prepare').closest('.actions'),status=q('trade-status');
  mode.classList.add('swap-mode');chain.classList.add('swap-network');send.append(make('h3','Send'),amount,from,chain);receive.append(make('h3','Receive'));const output=make('div',null,'swap-output-token'),hint=make('p','Quoted output appears in exact review.');hint.id='swap-output-hint';receive.append(output,hint);advanced.append(summary,provider,operation,recipient,slippage,pool);
  const direction=make('button','⇅','swap-direction');direction.type='button';direction.setAttribute('aria-label','Reverse swap asset pair');direction.onclick=()=>{const choices=[...q('trade-token-in').options].filter(o=>!o.disabled);if(choices.length!==2||q('trade-mode').value!=='swap'||q('trade-operation').value!=='swap')return;q('trade-token-in').value=choices.find(o=>o.value!==q('trade-token-in').value).value;q('trade-token-in').dispatchEvent(new Event('change',{bubbles:true}));};
  form.replaceChildren(mode,send,direction,receive,advanced,actions,status);
  form.addEventListener('invalid',event=>{const details=event.target.closest('details');if(details){details.open=true;event.target.focus();}},true);
  function syncOutput(){const source=q('trade-token-in').value,chain=q('trade-chain').value,bridge=q('trade-mode').value==='bridge',asset=bridge?(chain==='ethereum'&&q('trade-provider').value==='relay'?'SOL':'USDC'):source==='USDC'?(chain==='ethereum'?'ETH':'SOL'):'USDC';output.replaceChildren();const icon=window.DriveKeyAssets.icon(asset);if(icon)output.append(icon);output.append(make('strong',asset),make('small',bridge?(chain==='ethereum'?'Solana':'Ethereum'):(chain==='ethereum'?'Ethereum':'Solana')));direction.disabled=bridge||q('trade-operation').value!=='swap';}
  form.addEventListener('change',syncOutput);syncOutput();
  const swap=document.querySelector('[data-page=swap]'),swapHeading=swap.querySelector('.page-heading');const support=swap.querySelector('.split aside'),marketPanel=make('section',null,'swap-market-panel'),marketRows=make('div');marketRows.id='swap-market-assets';marketPanel.append(make('h2','Market'),make('p','Live prices · supported assets and market-only coins'),marketRows);const help=make('details',null,'swap-route-help');help.append(make('summary','How your route is reviewed'),...support.children);support.append(marketPanel,help);swapHeading.querySelector('h1').textContent='Swap';const compose=make('div'),history=make('section',null,'swap-history');history.hidden=true;history.setAttribute('aria-label','Swap history');const children=[...swap.children].filter(n=>n!==swapHeading);compose.append(...children);const bar=make('div',null,'swap-tabs'),swapTab=make('button','Swap'),historyTab=make('button','History');bar.setAttribute('role','group');bar.setAttribute('aria-label','Swap view');bar.append(swapTab,historyTab);swapTab.setAttribute('aria-pressed','true');historyTab.setAttribute('aria-pressed','false');swapTab.onclick=()=>{compose.hidden=false;history.hidden=true;swapTab.setAttribute('aria-pressed','true');historyTab.setAttribute('aria-pressed','false');};historyTab.onclick=()=>{compose.hidden=true;history.hidden=false;swapTab.setAttribute('aria-pressed','false');historyTab.setAttribute('aria-pressed','true');renderHistory();};swap.append(bar,compose,history);
  function renderHistory(){history.replaceChildren(make('p','Selected account · local DriveKey swap and bridge journal'));const rows=window.DK.context().records.filter(r=>/swap|bridge/i.test(r.action||'')||Number(r.version)>=22);let day='';for(const r of rows){const next=new Date(r.createdAt||r.updatedAt).toLocaleDateString();if(next!==day){history.append(make('h2',next,'history-date'));day=next;}const b=window.makeActivityRow(r);history.append(b);}if(!rows.length)history.append(make('p','No swaps or bridges in this account’s local history.'));}
  document.addEventListener('drivekey-records-changed',()=>{if(!history.hidden)renderHistory();});
  const drawer=q('transactions-drawer');drawer.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const buttons=[...drawer.querySelectorAll('button')].filter(n=>!n.disabled&&n.getClientRects().length),first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
 }
 boot();
})();
