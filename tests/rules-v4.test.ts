import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {spawn,ChildProcess} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Contract,ContractFactory,JsonRpcProvider,Wallet,ZeroAddress,ZeroHash,keccak256,toUtf8Bytes,AbiCoder} from 'ethers';
import {encodeRules,rulesHash,policyMessage,rulesDomain,POLICY_TYPES,PAYMENT_APPROVAL_TYPES,validateRulesDraft,verifySignedRules,policyFingerprint,exactRulesAmount,type RulesBundle,type RulesDraft} from '../core/rules-protocol';
import {ROBINHOOD_USDG_IDENTITY} from '../core/robinhood-proxy-identity';
import solc from 'solc';
const artifact=JSON.parse(readFileSync('work/rc20/contracts.json','utf8'))['Rules.sol'];
const provider=new JsonRpcProvider('http://127.0.0.1:18563',4663,{staticNetwork:true,cacheTimeout:-1});
const wallets=Array.from({length:5},()=>Wallet.createRandom().connect(provider));
let process:ChildProcess,account:Contract,registry:Contract;
let rules:RulesBundle,draft:RulesDraft;
const id=(s:string)=>keccak256(toUtf8Bytes(s));
async function rejected(f:()=>Promise<unknown>){await expect(f()).rejects.toThrow();}
async function signed(d=draft){return wallets[0].signTypedData(rulesDomain(d.context),POLICY_TYPES,policyMessage(d));}
async function apply(d=draft){return (await account.applyPolicy(encodeRules(d.rules),d.context.revision,d.context.policyHash,d.context.safetyEpoch,d.authorizationExpiry,await signed(d))).wait();}
async function refresh(){draft.context.revision=Number(await account.revision());draft.context.safetyEpoch=Number(await account.safetyEpoch());draft.context.policyHash=await account.policyHash();draft.context.rules=structuredClone(rules);}
describe.sequential('RC20 synthetic local contract execution',()=>{
 beforeAll(async()=>{
  process=spawn(globalThis.process.execPath,['node_modules/@foundry-rs/anvil/bin.mjs','--port','18563','--chain-id','4663','--silent'],{stdio:'ignore',windowsHide:true});
  for(let i=0;i<60;i++){try{await provider.getBlockNumber();break;}catch{await new Promise(r=>setTimeout(r,100));}}
  for(const w of wallets)await provider.send('anvil_setBalance',[w.address,'0x3635c9adc5dea00000']);
  const a=artifact.DriveKeyAccountV4;
  const f=new ContractFactory(a.abi,a.evm.bytecode.object,wallets[0]);
  for(const roles of [[0,0,2,3],[0,1,0,3],[0,1,2,0],[0,1,1,3],[0,1,2,1],[0,1,2,2]])await rejected(()=>f.deploy(...roles.map(i=>wallets[i].address),ROBINHOOD_USDG_IDENTITY.token));
  account=await f.deploy(...wallets.slice(0,4).map(w=>w.address),ROBINHOOD_USDG_IDENTITY.token) as unknown as Contract;await account.waitForDeployment();
  registry=new Contract(await account.registry(),artifact.DriveKeyRegistryV4.abi,wallets[0]);
  await provider.send('anvil_setBalance',[await account.getAddress(),'0x3635c9adc5dea00000']);
  const now=(await provider.getBlock('latest'))!.timestamp;
  const limit={perPayment:'1000',rolling:'3000',sevenDay:'4000',thirtyDay:'5000',approvalAbove:'500',count:4};
  rules={agent:wallets[1].address,approver:wallets[2].address,guardian:wallets[3].address,expires:now+30*86400,weekdays:127,startMinute:0,endMinute:1440,categories:1,paused:false,eth:{...limit},usdg:{...limit},recipients:[{recipient:wallets[4].address,category:0,eth:{...limit},usdg:{...limit}}]};
  draft={kind:'drivekey-rules-draft',version:1,context:{kind:'drivekey-rules-context',version:1,chainId:4663,contractVersion:4,account:await account.getAddress(),registry:await registry.getAddress(),owner:wallets[0].address,ownerEpoch:1,safetyEpoch:0,revision:0,policyHash:ZeroHash,accountCodeHash:keccak256(await provider.getCode(await account.getAddress())),registryCodeHash:keccak256(await provider.getCode(await registry.getAddress())),usdg:ROBINHOOD_USDG_IDENTITY.token,reportedAt:new Date().toISOString(),blockNumber:0,blockHash:ZeroHash,paused:true,rules:null},rules,authorizationExpiry:now+86400,labels:{}};
 },30000);
 afterAll(async()=>{provider.destroy();process?.kill();});
 it('starts without spending authority; only exact owner authorization activates atomically',async()=>{
  await rejected(()=>account.connect(wallets[1]).getFunction('requestPayment')(id('zero'),ZeroAddress,wallets[4].address,1,0,draft.authorizationExpiry));
  await rejected(()=>account.applyPolicy(encodeRules(rules),0,ZeroHash,0,draft.authorizationExpiry,awaitSignatureWrong()));
  await apply();expect(await account.revision()).toBe(1n);expect(await account.policyHash()).toBe(rulesHash(rules));
  await rejected(()=>apply());
  await rejected(()=>registry.replace(encodeRules(rules)));
 });
 it('matches exact signatures and base-unit decimals; rejects extra fields',async()=>{
  expect(exactRulesAmount('0.000000000000000001','eth')).toBe('1');expect(exactRulesAmount('1.000001','usdg')).toBe('1000001');
  expect(()=>exactRulesAmount('0.0000001','usdg')).toThrow();expect(()=>validateRulesDraft({...draft,calldata:'0x'})).toThrow();
  const s={kind:'drivekey-rules-authorization',version:1,draft,fingerprint:policyFingerprint(draft),signature:await signed(),signedAt:new Date().toISOString()};expect(verifySignedRules(s).fingerprint).toBe(s.fingerprint);
  expect(()=>verifySignedRules({...s,draft:{...draft,context:{...draft.context,safetyEpoch:1}}})).toThrow();
  expect(()=>verifySignedRules({...s,signature:s.signature.slice(0,-2)+'00'})).toThrow();
 });
 it('emits pending approval separately; caps still block an approver',async()=>{
  const agent=account.connect(wallets[1]);
  let receipt=await (await agent.getFunction('requestPayment')(id('small'),ZeroAddress,wallets[4].address,400,0,draft.authorizationExpiry)).wait();
  expect(receipt.logs.some((l:any)=>{try{return account.interface.parseLog(l)?.name==='PaymentExecuted';}catch{return false;}})).toBe(true);
  receipt=await (await agent.getFunction('requestPayment')(id('large'),ZeroAddress,wallets[4].address,600,0,draft.authorizationExpiry)).wait();
  expect(receipt.logs.some((l:any)=>{try{return account.interface.parseLog(l)?.name==='ApprovalRequested';}catch{return false;}})).toBe(true);
  expect(receipt.logs.some((l:any)=>{try{return account.interface.parseLog(l)?.name==='PaymentExecuted';}catch{return false;}})).toBe(false);
  await rejected(()=>agent.getFunction('requestPayment')(id('cap'),ZeroAddress,wallets[4].address,1001,0,draft.authorizationExpiry));
  await rejected(()=>agent.getFunction('requestPayment')(id('wrong-category'),ZeroAddress,wallets[4].address,1,1,draft.authorizationExpiry));
  await rejected(()=>agent.getFunction('requestPayment')(id('small'),ZeroAddress,wallets[4].address,400,0,draft.authorizationExpiry));
 });
 it('stop defeats old signatures and invalidates pending approvals; fresh signature resumes',async()=>{
  await refresh();const before=structuredClone(draft);
  await (await account.connect(wallets[3]).getFunction('stop')()).wait();
  await rejected(()=>apply(before));
  await rejected(()=>account.connect(wallets[1]).getFunction('stop')());
  await refresh();await apply();
  expect(await account.paused()).toBe(false);
  await rejected(()=>account.connect(wallets[1]).getFunction('executeApproved')(id('large'),'0x'));
  const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address'],[ZeroAddress,wallets[4].address]));
  expect((await registry.usage(key))[0]).toBe(400n);
 });
 it('removal and re-addition preserve recipient counters',async()=>{
  const recipients=structuredClone(rules.recipients);await refresh();rules={...rules,recipients:[]};draft.rules=rules;await apply();
  await refresh();rules={...rules,recipients};draft.rules=rules;await apply();
  const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address'],[ZeroAddress,wallets[4].address]));expect((await registry.usage(key))[0]).toBe(400n);
 });
 it('separate approver signs exact details; approval execution emits payment and cannot replay',async()=>{
  const paymentId=id('approved-exact'),agent=account.connect(wallets[1]);
  await (await agent.getFunction('requestPayment')(paymentId,ZeroAddress,wallets[4].address,600,0,draft.authorizationExpiry)).wait();
  const payment={paymentId,asset:ZeroAddress,recipient:wallets[4].address,amount:'600',category:0,revision:await account.revision(),safetyEpoch:await account.safetyEpoch(),expiry:draft.authorizationExpiry};
  const bad=await wallets[2].signTypedData(rulesDomain(draft.context),PAYMENT_APPROVAL_TYPES,{...payment,amount:'601'});
  await rejected(()=>agent.getFunction('executeApproved')(paymentId,bad));
  const sig=await wallets[2].signTypedData(rulesDomain(draft.context),PAYMENT_APPROVAL_TYPES,payment);
  const receipt=await (await agent.getFunction('executeApproved')(paymentId,sig)).wait();
  expect(receipt.logs.some((l:any)=>{try{return account.interface.parseLog(l)?.name==='PaymentExecuted';}catch{return false;}})).toBe(true);
  await rejected(()=>agent.getFunction('executeApproved')(paymentId,sig));
 });
 it('failed bundle replacement is atomic and cannot reset counters',async()=>{
  await refresh();const revision=await account.revision(),hash=await account.policyHash();
  const bad=structuredClone(draft);bad.rules.approver=bad.rules.agent;
  await rejected(()=>apply(bad));expect(await account.revision()).toBe(revision);expect(await account.policyHash()).toBe(hash);
 });
 it('synthetic USDG transfer requires a matching transfer event and rejects unsupported assets',async()=>{
  const source='pragma solidity 0.8.30; contract Token {event Transfer(address indexed from,address indexed to,uint256 value); function transfer(address to,uint256 value) external returns(bool){emit Transfer(msg.sender,to,value);return true;}}';
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Token.sol':{content:source}},settings:{outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}})));
  await provider.send('anvil_setCode',[ROBINHOOD_USDG_IDENTITY.token,'0x'+output.contracts['Token.sol'].Token.evm.deployedBytecode.object]);
  const receipt=await (await account.connect(wallets[1]).getFunction('requestPayment')(id('usdg-local'),ROBINHOOD_USDG_IDENTITY.token,wallets[4].address,1,0,draft.authorizationExpiry)).wait();
  expect(receipt.logs.filter((l:any)=>l.address.toLowerCase()===ROBINHOOD_USDG_IDENTITY.token.toLowerCase())).toHaveLength(1);
  await rejected(()=>account.connect(wallets[1]).getFunction('requestPayment')(id('other-token'),wallets[4].address,wallets[4].address,1,0,draft.authorizationExpiry));
 });
 it('enforces payment counts independently of amounts',async()=>{
  const snapshot=await provider.send('evm_snapshot',[]),agent=account.connect(wallets[1]);
  try{for(let i=0;i<2;i++)await (await agent.getFunction('requestPayment')(id('count-'+i),ZeroAddress,wallets[4].address,1,0,draft.authorizationExpiry)).wait();
   await rejected(()=>agent.getFunction('requestPayment')(id('count-over'),ZeroAddress,wallets[4].address,1,0,draft.authorizationExpiry));
  }finally{await provider.send('evm_revert',[snapshot]);}
 });
 it('seven-day and 30-day counters reset only at their fixed period boundaries',async()=>{
  const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address'],[ZeroAddress,wallets[4].address]));
  for(const [period,index] of [[7*86400,2],[30*86400,3]]){
   const snapshot=await provider.send('evm_snapshot',[]);
   try{const now=(await provider.getBlock('latest'))!.timestamp,boundary=(Math.floor(now/period)+1)*period;
    await provider.send('evm_setNextBlockTimestamp',[boundary-1]);await provider.send('evm_mine',[]);expect((await registry.usage(key))[index]).toBe(1000n);
    await provider.send('evm_setNextBlockTimestamp',[boundary]);await provider.send('evm_mine',[]);expect((await registry.usage(key))[index]).toBe(0n);
   }finally{await provider.send('evm_revert',[snapshot]);}
  }
 });
 it('counters conservatively retain hourly spend then release; expiry blocks payments',async()=>{
  const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','address'],[ZeroAddress,wallets[4].address]));
  expect((await registry.usage(key))[0]).toBe(1000n);
  await provider.send('evm_increaseTime',[24*3600]);await provider.send('evm_mine',[]);
  expect((await registry.usage(key))[0]).toBe(1000n);
  await provider.send('evm_increaseTime',[3600]);await provider.send('evm_mine',[]);
  expect((await registry.usage(key))[0]).toBe(0n);
  await rejected(()=>apply());
  await provider.send('evm_setNextBlockTimestamp',[rules.expires]);await provider.send('evm_mine',[]);
  await rejected(()=>account.connect(wallets[1]).getFunction('requestPayment')(id('expired-policy'),ZeroAddress,wallets[4].address,1,0,rules.expires+1));
 });
});
async function awaitSignatureWrong(){return wallets[1].signTypedData(rulesDomain(draft.context),POLICY_TYPES,policyMessage(draft));}
