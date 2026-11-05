(function(){
  'use strict';
  const labels={swap:'Swap',approve:'Approve exact amount',revoke:'Revoke allowance',bridge:'Bridge',redeem:'Complete incoming Mayan bridge',uniswap:'Uniswap v3',lifi:'LI.FI',relay:'LI.FI / Relay',mayan:'Mayan'};
  function init(DK){
    const $=id=>document.getElementById(id),needed=['trade-form','trade-mode','trade-provider','trade-chain','trade-token-in','trade-amount','trade-recipient','trade-slippage','trade-pool-fee','trade-operation','trade-prepare','trade-import','trade-status','private-form','private-chain','private-action','private-asset','private-amount','private-discover','private-quote','private-import','private-status','private-quote-result'];
    if(needed.some(id=>!$(id)))throw Error('Native route controls are incomplete.');
    const value=id=>$(id).value,hide=(id,state)=>{if($(id))$(id).hidden=state;},status=(id,text)=>{$(id).textContent=text;};
    let quoteRevision=0,lastSuggestedRecipient='';
    function options(id,values){const select=$(id),old=select.value,existing=Array.from(select.options).map(o=>o.value);if(existing.join('|')!==values.join('|'))select.replaceChildren(...values.map(v=>{const option=document.createElement('option');option.value=v;option.textContent=labels[v]||v;return option;}));select.value=values.includes(old)?old:values[0];}
    function wallet(){const context=DK.context();return context.public||context.wallet?.public;}
    function assertOnline(){const context=DK.context();if(context.offline)throw Error('Prepare this request in the online app.');const selected=wallet();if(!selected)throw Error('Choose a wallet first.');return selected;}
    function fieldInvalid(id,message){if(DK.invalid)return DK.invalid(id,message);throw Error(message);}
    function bps(){const raw=value('trade-slippage').trim();if(!/^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/.test(raw))return fieldInvalid('trade-slippage','Use a slippage limit from 0% to 1%, with up to two decimals.');return Math.round(Number(raw)*100);}
    function amount(id,asset){try{return DK.units(value(id).trim(),asset);}catch(error){return fieldInvalid(id,error.message);}}
    function showError(id,error){status(id,error?.message||'The request could not be prepared.');}
    function restoreControls(){
      const unavailable=DK.context().offline||!wallet();
      for(const id of ['trade-prepare','trade-import','private-quote','private-import'])$(id).disabled=unavailable;
      for(const id of ['private-allowance','private-approve','private-revoke'])if($(id))$(id).disabled=unavailable||value('private-chain')!=='ethereum';
    }
    async function prepareWithStatus(id,method,input){
      const revision=quoteRevision,identity=wallet()?.deviceId;
      const current=()=>revision===quoteRevision&&wallet()?.deviceId===identity;
      try{
        const result=await DK.prepare(method,input);
        if(current())status(id,result?.token&&result.review?'Request ready for exact review.':'No request prepared. Check the message above before continuing.');
        return result;
      }catch(error){if(current())showError(id,error);return null;}
    }
    function syncTrade(){
      const bridge=value('trade-mode')==='bridge',chain=value('trade-chain');
      options('trade-provider',bridge?['relay','mayan']:chain==='solana'?['lifi']:['uniswap','lifi']);
      const provider=value('trade-provider');
      options('trade-operation',bridge?provider==='mayan'&&chain==='ethereum'?['bridge','approve','revoke','redeem']:['bridge']:chain==='ethereum'?['swap','approve','revoke']:['swap']);
      const operation=value('trade-operation'),file=bridge&&provider==='mayan'&&(chain==='solana'||operation==='redeem'),allowance=['approve','revoke'].includes(operation);
      options('trade-token-in',bridge?[provider==='relay'&&chain==='ethereum'?'ETH':'USDC']:allowance?['USDC']:chain==='ethereum'?['ETH','USDC']:['SOL','USDC']);
      hide('trade-pool-field',bridge||provider!=='uniswap');hide('trade-amount-field',file||operation==='revoke');hide('trade-recipient-field',file||allowance||!bridge&&chain==='solana');hide('trade-slippage-field',file||allowance);hide('trade-asset-field',file);hide('trade-import',!file);hide('trade-prepare',file);
      const publicWallet=wallet(),source=chain==='ethereum'?publicWallet?.evmAddress:publicWallet?.solanaAddress;
      const suggested=source?(bridge?(chain==='ethereum'?publicWallet.solanaAddress:publicWallet.evmAddress):source):'';
      if(!value('trade-recipient')||value('trade-recipient')===lastSuggestedRecipient)$('trade-recipient').value=suggested;
      lastSuggestedRecipient=suggested;
      if($('trade-pair')){const from=value('trade-token-in'),to=bridge?(provider==='relay'&&chain==='ethereum'?'SOL':'USDC'):(from==='USDC'?(chain==='ethereum'?'ETH':'SOL'):'USDC');$('trade-pair').textContent=file&&operation==='redeem'?'Solana USDC → Ethereum USDC · destination redemption':(chain==='ethereum'?'Ethereum ':'Solana ')+from+' → '+(bridge?(chain==='ethereum'?'Solana ':'Ethereum '):'')+to+(allowance?' · '+labels[operation]:'');}
      const context=DK.context(),unavailable=context.offline||!publicWallet;
      $('trade-prepare').disabled=unavailable;$('trade-import').disabled=unavailable;
      $('trade-prepare').textContent=allowance?labels[operation]:'Get quote & review';
      if(file)status('trade-status',operation==='redeem'?'Import the verified source and attestation bundle. The destination still needs your approval.':'Import a prepared Mayan source plan with its offline-derived auxiliary public identity.');
      else if(unavailable)status('trade-status',context.offline?'Prepare swaps and bridges in the online app.':'Choose a wallet to prepare a request.');
      else if(bridge)status('trade-status',provider==='relay'?(chain==='ethereum'?'ETH on Ethereum → SOL on Solana.':'USDC on Solana → USDC on Ethereum.'):'USDC on Ethereum → USDC on Solana.');
      else status('trade-status',chain==='solana'?'SOL ↔ USDC. Output returns to this wallet.':'ETH ↔ USDC. USDC spending uses a separate exact allowance.');
    }
    function syncPrivate(){
      const chain=value('private-chain'),action=value('private-action');
      options('private-asset',chain==='ethereum'?['ETH','USDC']:['SOL','USDC']);
      options('private-discover',action==='withdraw'?['withdrawal-fee']:['swap-quote','swap-fee','withdrawal-fee']);
      const unavailable=DK.context().offline||!wallet();$('private-quote').disabled=unavailable;$('private-import').disabled=unavailable;
      const allowance=chain==='ethereum';hide('private-allowance-controls',!allowance);if($('private-allowance'))$('private-allowance').disabled=unavailable||!allowance;
      for(const id of ['private-approve','private-revoke'])if($(id)){$(id).disabled=unavailable||!allowance;$(id).hidden=!allowance;}
      if($('private-visibility'))$('private-visibility').textContent=({deposit:'The deposit transaction is public. The resulting funds enter Hinkal.',withdraw:'This withdrawal sends funds to a public address.',transfer:'Send from shielded funds. Check the recipient and amount in the imported request.',swap:'Swap shielded funds. The imported request sets the assets, amount and minimum output.'})[action];
      status('private-status',DK.context().offline?'Import the final unsigned transaction in Review & sign.':!wallet()?'Choose a wallet first.':'Import a prepared '+(action==='transfer'?'private send':action)+' bundle. It contains sensitive proof metadata; no keys or view secrets.');
    }
    function changed(){quoteRevision++;$('private-quote-result').replaceChildren();DK.invalidate();syncTrade();syncPrivate();}
    for(const id of ['trade-mode','trade-provider','trade-chain','trade-token-in','trade-operation','trade-pool-fee','private-chain','private-action','private-asset','private-discover','private-allowance-operation'])if($(id))$(id).addEventListener('change',changed);
    for(const id of ['trade-amount','trade-recipient','trade-slippage','private-amount','private-allowance-amount'])if($(id))$(id).addEventListener('input',()=>{quoteRevision++;$('private-quote-result').replaceChildren();DK.invalidate();});
    $('trade-form').addEventListener('submit',async event=>{
      event.preventDefault();try{
        const publicWallet=assertOnline(),chain=value('trade-chain'),provider=value('trade-provider'),operation=value('trade-operation'),bridge=value('trade-mode')==='bridge',asset=value('trade-token-in'),allowance=['approve','revoke'].includes(operation),source=chain==='ethereum'?publicWallet.evmAddress:publicWallet.solanaAddress;
        if(bridge&&provider==='mayan'&&(chain==='solana'||operation==='redeem'))throw Error('Use Import prepared plan for this bridge stage.');
        const recipient=allowance?(bridge&&provider==='mayan'?publicWallet.solanaAddress:source):!bridge&&chain==='solana'?source:value('trade-recipient').trim(),destination=bridge?(chain==='ethereum'?'solana':'ethereum'):chain;
        if(!allowance&&!(destination==='ethereum'?/^0x[0-9a-fA-F]{40}$/.test(recipient):/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient)))fieldInvalid('trade-recipient','Enter a full address for the destination network.');
        const input={amount:operation==='revoke'?'0':amount('trade-amount',asset),recipient,slippageBps:allowance?0:bps()};
        let method;
        if(bridge&&provider==='relay'){input.chain=chain;method=chain==='ethereum'?'prepareLifiRelayEvm':'prepareLifiRelaySolana';}
        else if(bridge){input.action=operation;method='prepareLifiMayanEvmSource';}
        else{input.tokenIn=asset;method=chain==='solana'?'prepareLifiSolana':provider==='uniswap'?'prepareSwap':'prepareLifiEvm';if(chain==='ethereum')input.action=operation;if(provider==='uniswap')input.poolFee=Number(value('trade-pool-fee'));}
        status('trade-status','Checking the route, fees and exact transaction…');await prepareWithStatus('trade-status',method,input);
      }catch(error){showError('trade-status',error);}
    });
    $('trade-import').addEventListener('click',async()=>{try{assertOnline();if(value('trade-mode')!=='bridge'||value('trade-provider')!=='mayan')throw Error('Select a supported Mayan bridge stage.');const route=value('trade-chain')==='solana'?'mayan-solana-source':value('trade-operation')==='redeem'?'mayan-evm-redeem':null;if(!route)throw Error('Select the incoming bridge completion stage.');status('trade-status','Opening the prepared bridge plan…');await prepareWithStatus('trade-status','importPreparedBridge',{route});}catch(error){showError('trade-status',error);}});
    $('private-form').addEventListener('submit',event=>{event.preventDefault();$('private-import').click();});
    $('private-import').addEventListener('click',async()=>{try{assertOnline();status('private-status','Opening the prepared proof or plan…');await prepareWithStatus('private-status','importPreparedPrivate',{chain:value('private-chain'),action:value('private-action')});}catch(error){showError('private-status',error);}});
    $('private-quote').addEventListener('click',async()=>{
      const revision=++quoteRevision,identity=wallet()?.deviceId;$('private-quote-result').replaceChildren();try{
        assertOnline();const chain=value('private-chain'),asset=value('private-asset'),action=value('private-discover'),input={chain,tokenIn:asset,action,amount:amount('private-amount',asset)};
        status('private-status','Reading a public provider quote…');const result=await DK.call('hinkalDiscover',input);
        if(revision!==quoteRevision||wallet()?.deviceId!==identity)return;
        if(!result){status('private-status','Public quote unavailable. Check the message above and try again.');return;}
        const expected=result.request;if(!expected||Object.keys(input).some(key=>expected[key]!==input[key]))throw Error('Provider response differs from the requested quote.');
        const output=$('private-quote-result');output.replaceChildren();const add=text=>{const p=document.createElement('p');p.textContent=text;output.append(p);};
        if(action==='swap-quote'){
          const quoted=result.result?.outSwapAmountValue;if(typeof quoted!=='string'||!/^\d+$/.test(quoted))throw Error('Provider did not return a supported quote amount.');
          const to=asset==='USDC'?(chain==='ethereum'?'ETH':'SOL'):'USDC';add('Indicative output: '+DK.formatUnits(quoted,to)+' '+to+'.');
        }else add('Public fee quote received. Review the exact fee limits in the prepared transaction.');
        add('This is a provider read. No proof was created and no transaction was signed.');status('private-status','Public provider response received.');
      }catch(error){if(revision===quoteRevision&&wallet()?.deviceId===identity)showError('private-status',error);}
    });
    async function allowance(operation){try{const publicWallet=assertOnline();if(value('private-chain')!=='ethereum')throw Error('This allowance is for Ethereum USDC only.');if(!['approve','revoke'].includes(operation))throw Error('Choose approve or revoke.');status('private-status','Preparing the exact USDC allowance…');await prepareWithStatus('private-status','prepareHinkal',{action:'hinkal-'+operation,asset:'USDC',amount:operation==='revoke'?'0':amount($('private-allowance-amount')?'private-allowance-amount':'private-amount','USDC'),recipient:publicWallet.evmAddress,data:'0x',inputNotes:[]});}catch(error){showError('private-status',error);}}
    if($('private-allowance'))$('private-allowance').addEventListener('click',()=>allowance($('private-allowance-operation')?.value));
    for(const operation of ['approve','revoke'])if($('private-'+operation))$('private-'+operation).addEventListener('click',()=>allowance(operation));
    syncTrade();syncPrivate();return {restoreControls,refresh(){quoteRevision++;$('private-quote-result').replaceChildren();syncTrade();syncPrivate();}};
  }
  window.DriveKeyRoutes=Object.freeze({init});
})();
