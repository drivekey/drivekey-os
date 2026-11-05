'use strict';
(()=>{
 const q=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 let searchQuery='',market=null,holdings=[],identity=null,hidden=false,currency='usd',busy=false,marketAt=0,balanceAt=0;const accountCache=new Map();let accountsBusy=false;
 const assets=[['ethereum','ETH'],['ethereum','USDC'],['solana','SOL'],['solana','USDC']];
 const money=n=>hidden?'••••':Number.isFinite(n)&&Math.abs(n)<1e15?new Intl.NumberFormat(undefined,{style:'currency',currency:currency.toUpperCase(),maximumFractionDigits:2}).format(n):'Unavailable';
 const icon=s=>{const n=el('span',undefined,'asset-identity asset-'+s.toLowerCase()),image=window.DriveKeyAssets.icon(s);if(image)n.append(image);else n.textContent=s.slice(0,1);n.setAttribute('aria-hidden','true');return n;};
 function valuation(asset, rawAmount) {
  const price = market?.prices.find(row => row.symbol === asset);
  if (!price || !/^[0-9]+$/.test(rawAmount || '')) return null;
  const units = window.DK.formatUnits(rawAmount, asset);
  const value = Number(units) * price.price;
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
  return {label: money(value), asOf: price.asOf || market.fetchedAt, stale: Boolean(market.stale)};
 }
 window.DriveKeyPortfolio = Object.freeze({valuation});
 function renderPortfolioTotal(value, available) {
  const target = q('portfolio-total');
  target.replaceChildren();
  if (!available || hidden) {
    target.textContent = available ? '••••' : 'Value unavailable';
    return;
  }
  const parts = new Intl.NumberFormat(undefined, {
    style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2
  }).formatToParts(value);
  for (const part of parts) {
    target.append(el('span', part.value,
      ['decimal', 'fraction'].includes(part.type) ? 'portfolio-fraction' : ''));
  }
 }
 async function read(name,...args){try{const r=await window.drivekey[name](...args);return r?.ok?r.result:null;}catch{return null;}}
 function render(){
  document.body.dataset.hideBalances=String(hidden);if(typeof window.renderActivity==='function')window.renderActivity();q('hide-balances').textContent=hidden?'Show balances':'Hide balances';q('hide-balances').setAttribute('aria-pressed',String(hidden));
  const cards=q('market-cards');cards.replaceChildren();for(const p of (market?.prices||[]).filter(p=>[p.name,p.symbol].some(v=>v.toLowerCase().includes(searchQuery)))){const card=el('article',undefined,'market-card');card.append(icon(p.symbol),el('strong',p.symbol),el('span',money(p.price)));if(p.change24h!==null)card.append(el('small',hidden?'••••':(p.change24h>0?'+':'')+p.change24h.toFixed(2)+'%',p.change24h>=0?'positive':'negative'));if(!p.walletSupported)card.append(el('small','Market only'));cards.append(card);}
  const swapMarket=q('swap-market-assets');if(swapMarket){swapMarket.replaceChildren();for(const p of market?.prices||[]){const r=el('div',undefined,'swap-market-row'),name=el('span');name.append(el('strong',p.name),el('small',p.walletSupported?p.symbol:'Market only'));r.append(icon(p.symbol),name,el('span',money(p.price)));swapMarket.append(r);}if(!swapMarket.children.length)swapMarket.append(el('p','Market data unavailable. Refresh to retry.'));if(market?.stale)swapMarket.append(el('p','Stale prices · refresh failed'));}
  q('market-status').textContent=market?(market.stale?'Stale prices · ':'Prices · ')+market.source+' · '+new Date(market.fetchedAt).toLocaleTimeString():busy?'Loading market prices…':'Market data unavailable. Refresh to retry.';
  const list=q('home-balances');list.replaceChildren();let sum=0,priced=0,visibleRows=0;for(const h of holdings){const row=el('div',undefined,'holding-row'),label=el('span',undefined,'holding-identity');label.append(icon(h.asset),el('strong',h.asset),el('small',h.chain==='ethereum'?'Ethereum':'Solana'));const price=market?.prices.find(p=>p.symbol===h.asset);const units=h.amount===undefined?null:window.DK.formatUnits(h.amount,h.asset);let estimate=null;if(price&&units!==null){const value=Number(units)*price.price;if(Number.isFinite(value)&&value<1e15){estimate=value;sum+=value;priced++;}}row.append(label,el('span',price?money(price.price):'Unavailable'),el('span',units===null?'Unavailable':hidden?'••••':units+' '+h.asset),el('span',estimate===null?'Unavailable':money(estimate)));const change=price?.change24h;row.append(el('span',hidden?'••••':Number.isFinite(change)?(change>0?'+':'')+change.toFixed(2)+'%':'Unavailable',Number.isFinite(change)?change>=0?'positive':'negative':''));if(h.stale)row.append(el('small','Last known · refresh failed'));if([h.asset,h.chain].some(v=>v.toLowerCase().includes(searchQuery))){list.append(row);visibleRows++;}}
  if(!holdings.length)list.append(el('p','Select an account to check public holdings.'));else if(!visibleRows)list.append(el('p','No matching holdings.'));if(searchQuery&&!cards.children.length)cards.append(el('p','No matching market assets.'));
  renderPortfolioTotal(sum, priced > 0);document.querySelectorAll('[data-account-value]').forEach(n=>{const data=accountCache.get(n.dataset.accountValue);let value=0,count=0;for(const b of data?.balances||[]){const p=market?.prices.find(p=>p.symbol===b.asset);if(p&&b.amount!==undefined){const v=Number(window.DK.formatUnits(b.amount,b.asset))*p.price;if(Number.isFinite(v)&&v<1e15){value+=v;count++;}}}n.textContent=data?(count?money(value)+(count<4?' subtotal':''):'Unavailable'):'Not checked';if(data?.balances.some(b=>b.stale))n.textContent+=' · stale';if(data){const times=data.balances.map(b=>b.observedAt).filter(Boolean).sort();n.append(el('small',times.length?'Balances observed '+new Date(times[0]).toLocaleTimeString():'Observation time unavailable','account-observed-at'));}});q('portfolio-coverage').textContent=(priced===assets.length?'Estimated total':'Priced subtotal · '+priced+' of '+assets.length+' balances')+(market?.stale||holdings.some(h=>h.stale)?' · stale data':'');
 }
 async function refresh(force=false){if(busy||document.hidden||window.DK.context().offline)return;busy=true;q('refresh-data').setAttribute('aria-busy','true');const ctx=window.DK.context(),id=ctx.public?.deviceId||null;
  try{if(force||Date.now()-marketAt>60000){marketAt=Date.now();const result=await read('marketSnapshot',currency);if(result&&result.currency===currency)market=result;else if(market)market={...market,stale:true};}
   if(id&&(force||Date.now()-balanceAt>45000)){balanceAt=Date.now();const result=await read('accountBalances',ctx.activeId);if(window.DK.context().public?.deviceId!==id)return;if(result?.accountId===ctx.activeId&&Array.isArray(result.balances)){holdings=result.balances;accountCache.set(ctx.activeId,{...result,at:Date.now()});}else holdings=holdings.map(h=>({...h,stale:true}));const checked=holdings.map(h=>h.observedAt).filter(Boolean).sort();q('balance-time').textContent=checked.length?'Last successful balance read '+new Date(checked[checked.length-1]).toLocaleTimeString()+(holdings.some(h=>h.stale)?' · some reads unavailable or stale':''):'Balance check completed · observation time unavailable';}
  }finally{busy=false;q('refresh-data').setAttribute('aria-busy','false');render();}
 }
 async function refreshAccounts(force=false){if(accountsBusy||document.hidden||window.DK.context().offline)return;accountsBusy=true;try{for(const wallet of window.DK.context().wallets){if(window.DK.context().page!=='vault')break;const old=accountCache.get(wallet.id);if(!force&&old&&Date.now()-old.at<45000)continue;const result=await read('accountBalances',wallet.id);if(result?.accountId===wallet.id)accountCache.set(wallet.id,{...result,at:Date.now()});else if(old)accountCache.set(wallet.id,{...old,at:Date.now(),balances:old.balances.map(b=>({...b,stale:true}))});render();}}finally{accountsBusy=false;}}
 async function boot(){if(document.body.dataset.ready!=='true'){setTimeout(boot,30);return;}
  try{const saved=localStorage.getItem('drivekey-display-currency-v1');if(['usd','eur','pln'].includes(saved))currency=saved;}catch{}q('display-currency').value=currency;
  const wallet=q('wallet-selector');
  const actions=document.querySelector('.topbar-actions');
  const tools=el('div',undefined,'header-tools');
  tools.append(q('refresh-data'),q('hide-balances'),q('transactions-drawer-open'));
  const account=el('div',undefined,'header-account');
  const context=el('div',undefined,'header-context');
  context.append(q('mode-pill'),q('app-update-state'));
  account.append(wallet,context,q('lock'));
  actions.append(tools,account);
  q('refresh-data').title='Refresh balances and market prices';
  q('lock').title='Clear the selected wallet from this session';
  document.querySelectorAll('.nav-item').forEach(b=>{b.setAttribute('aria-label',b.textContent.trim());b.title=b.textContent.trim();});
  q('refresh-data').onclick=async()=>{await refresh(true);if(window.DK.context().page==='vault')await refreshAccounts(true);};q('refresh-balances').onclick=()=>refresh(true);q('hide-balances').onclick=()=>{hidden=!hidden;render();};
  q('display-currency').addEventListener('change',()=>{currency=q('display-currency').value;market=null;marketAt=0;try{localStorage.setItem('drivekey-display-currency-v1',currency);}catch{}refresh(true);});
  q('workspace-search').addEventListener('keydown',e=>{if(e.key!=='Enter')return;const ctx=window.DK.context(),value=e.target.value;if(ctx.page==='home'){searchQuery=value.trim().toLowerCase();render();q('market-cards').scrollIntoView({block:'nearest'});return;}const target=ctx.page==='activity'?'activity':'vault';window.DK.view(target);const input=q(target==='activity'?'activity-search':'wallet-search');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
  q('workspace-search').addEventListener('input',e=>{if(window.DK.context().page==='home'){searchQuery=e.target.value.trim().toLowerCase();render();}});
  const drawer=q('transactions-drawer');q('transactions-drawer-open').onclick=async()=>{const ctx=window.DK.context(),rows=ctx.public?await read('listTransactions'):[];if(ctx.public?.deviceId!==window.DK.context().public?.deviceId)return;const list=q('transactions-drawer-list');list.replaceChildren();for(const row of rows||[]){const b=el('button',(row.action||row.asset||'Transaction')+' · '+row.state);const assetIcon=window.DriveKeyAssets.icon(row.inputAsset||row.asset);if(assetIcon)b.prepend(assetIcon);b.onclick=()=>{drawer.close();window.openTransaction(row.id);};list.append(b);}if(!list.children.length)list.append(el('p','No local transactions for this account.'));drawer.showModal();q('transactions-drawer-close').focus();};q('transactions-drawer-close').onclick=()=>drawer.close();q('drawer-full-history').onclick=()=>{drawer.close();window.DK.view('activity');};drawer.addEventListener('close',()=>q('transactions-drawer-open').focus());
  const articles=await read('listUpdates');
  for(const post of (articles||[]).slice(0,2)){
   const card=el('button',undefined,'article-banner');
   const copy=el('span',undefined,'article-copy');
   const meta=el('span',undefined,'article-meta');
   meta.append(el('span','DriveKey journal'),el('time',post.date));
   const title=el('strong',post.title,'article-title');
   const summary=el('span',post.summary||'','article-summary');
   const link=el('span','Read on X','article-link');
   const arrow=el('span','\u2197');arrow.setAttribute('aria-hidden','true');link.append(arrow);
   copy.append(meta,title,summary,link);
   const art=el('span',undefined,'article-art'),image=el('img');
   image.src=['assets/blue/illustration-handoff-1200.png','assets/usb-pcb-detail.png','assets/usb-pcb-hero.png'].includes(post.thumbnail)?post.thumbnail:'assets/blue/illustration-handoff-1200.png';
   image.alt='';art.setAttribute('aria-hidden','true');art.append(image);
   card.append(copy,art);card.onclick=()=>window.DK.call('openWeb','article',post.id);
   q('home-articles').append(card);
  }
  const form=q('trade-form'),original=form.parentNode,next=form.nextSibling;
  function layout(){const ctx=window.DK.context(),id=ctx.public?.deviceId||null;if(id!==identity){identity=id;holdings=[];balanceAt=0;if(!id)accountCache.clear();render();}const home=ctx.page==='home'&&!ctx.offline;if(home&&form.parentNode!==q('home-swap-host'))q('home-swap-host').append(form);else if(!home&&form.parentNode!==original)original.insertBefore(form,next);if((home||ctx.page==='swap')&&!document.hidden)refresh();if(ctx.page==='vault'&&!ctx.offline&&!document.hidden){refresh();refreshAccounts();}}
  new MutationObserver(layout).observe(document.querySelector('main'),{subtree:true,attributes:true,attributeFilter:['hidden']});setInterval(layout,1000);document.addEventListener('visibilitychange',layout);render();layout();
 }
 boot();
})();
