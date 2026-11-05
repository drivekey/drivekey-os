'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.listeners=new Map();}
  get options(){return this.children;}
  replaceChildren(...children){this.children=children;}
  append(child){this.children.push(child);}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
  async emit(name){await Promise.all((this.listeners.get(name)||[]).map(fn=>fn({preventDefault(){}})));}
  click(){return this.emit('click');}
}
function setup(){
  const ids=['trade-form','trade-mode','trade-provider','trade-chain','trade-token-in','trade-amount','trade-recipient','trade-slippage','trade-pool-fee','trade-operation','trade-prepare','trade-import','trade-status','trade-pool-field','trade-asset-field','trade-amount-field','trade-recipient-field','trade-slippage-field','trade-operation-field','private-form','private-chain','private-action','private-asset','private-amount','private-discover','private-quote','private-import','private-status','private-quote-result','private-visibility','private-allowance-amount','private-allowance-controls','private-approve','private-revoke'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()])),document={getElementById:id=>elements[id]||null,createElement:tag=>new Element(tag)},window={};
  for(const [key,value]of Object.entries({'trade-mode':'swap','trade-chain':'ethereum','trade-amount':'1','trade-slippage':'0.5','trade-pool-fee':'3000','private-chain':'ethereum','private-action':'deposit','private-amount':'99','private-allowance-amount':'10'}))elements[key].value=value;
  const context={public:{deviceId:'wallet-1',evmAddress:'0x1111111111111111111111111111111111111111',solanaAddress:'11111111111111111111111111111111'},offline:false,revision:0},calls=[];
  const DK={context:()=>context,units:(value)=>{if(!/^\d+$/.test(value))throw Error('Invalid amount.');return value;},formatUnits:value=>value,call:async(method,input)=>{calls.push({method,input});return null;},prepare:async(method,input)=>{calls.push({method,input});return null;},invalidate:()=>{context.revision++;}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/routes.js'),'utf8'),{window,document});
  const controls=window.DriveKeyRoutes.init(DK);return {elements,context,calls,DK,controls};
}
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
test('route initialization performs no request and null preparation ends checking status',async()=>{
  const s=setup();assert.equal(s.calls.length,0);await s.elements['trade-form'].emit('submit');assert.match(s.elements['trade-status'].textContent,/No request prepared/);assert.equal(s.calls[0].method,'prepareSwap');
});
test('null public quote clears old output and ends reading status',async()=>{
  const s=setup();s.elements['private-quote-result'].append(new Element());await s.elements['private-quote'].click();assert.equal(s.elements['private-quote-result'].children.length,0);assert.match(s.elements['private-status'].textContent,/Public quote unavailable/);
});
test('late null preparation cannot overwrite the new route status',async()=>{
  const s=setup(),pending=deferred();s.DK.prepare=()=>pending.promise;const running=s.elements['trade-form'].emit('submit');assert.match(s.elements['trade-status'].textContent,/Checking/);
  s.elements['trade-chain'].value='solana';await s.elements['trade-chain'].emit('change');const current=s.elements['trade-status'].textContent;pending.resolve(null);await running;assert.equal(s.elements['trade-status'].textContent,current);assert.match(current,/returns to this wallet/);
});
test('late preparation rejection cannot overwrite a new selection',async()=>{
  const s=setup(),pending=deferred();s.DK.prepare=()=>pending.promise;const running=s.elements['private-import'].click();s.elements['private-action'].value='withdraw';await s.elements['private-action'].emit('change');const current=s.elements['private-status'].textContent;pending.reject(Error('old failure'));await running;assert.equal(s.elements['private-status'].textContent,current);assert.match(current,/withdraw/);
});
test('late public quote failure cannot overwrite a new action or wallet',async()=>{
  const s=setup(),pending=deferred();s.DK.call=()=>pending.promise;const running=s.elements['private-quote'].click();s.context.public={...s.context.public,deviceId:'wallet-2'};s.controls.refresh();const current=s.elements['private-status'].textContent;pending.resolve(null);await running;assert.equal(s.elements['private-status'].textContent,current);assert.equal(s.elements['private-quote-result'].children.length,0);
});
test('restoration callback applies current mode without changing result messages',()=>{
  const s=setup();s.elements['private-status'].textContent='Keep this result';s.context.offline=true;s.controls.restoreControls();assert.equal(s.elements['private-import'].disabled,true);assert.equal(s.elements['trade-prepare'].disabled,true);assert.equal(s.elements['private-status'].textContent,'Keep this result');s.context.offline=false;s.context.public=null;s.controls.restoreControls();assert.equal(s.elements['private-quote'].disabled,true);
});
test('USDC allowance uses its separate amount and remains independent of quote asset',async()=>{
  const s=setup();assert.equal(s.elements['private-asset'].value,'ETH');await s.elements['private-approve'].click();assert.equal(s.calls[0].method,'prepareHinkal');assert.equal(s.calls[0].input.amount,'10');assert.equal(s.calls[0].input.asset,'USDC');assert.equal(s.calls[0].input.action,'hinkal-approve');assert.match(s.elements['private-status'].textContent,/No request prepared/);
});
test('editing separate allowance amount invalidates outstanding review',async()=>{
  const s=setup();const old=s.context.revision;await s.elements['private-allowance-amount'].emit('input');assert.ok(s.context.revision>old);
});
