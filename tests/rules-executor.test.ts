import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Interface,keccak256,ZeroAddress,ZeroHash,Transaction,type JsonRpcProvider} from 'ethers';
import {RulesExecutor,RULES_ACCOUNT_ABI,authenticateRulesAgent} from '../core/rules-executor';
import {ROBINHOOD_USDG_IDENTITY} from '../core/robinhood-proxy-identity';
import {readJsonFile} from '../core/files';
const fault=vi.hoisted(()=>({submitted:false}));
vi.mock('../core/robinhood-proxy-identity',async importOriginal=>({...await importOriginal<object>(),checkKnownRobinhoodProxy:vi.fn(async()=>({blockNumber:'0x1'}))}));
vi.mock('../core/files',async importOriginal=>{const actual=await importOriginal<typeof import('../core/files')>();return {...actual,writeJsonFile:async(...args:Parameters<typeof actual.writeJsonFile>)=>{if(fault.submitted&&(args[2] as {status?:string}).status==='submitted'){fault.submitted=false;throw Error('Injected post-broadcast persistence failure');}return actual.writeJsonFile(...args);}};});
const dirs:string[]=[];afterEach(async()=>{fault.submitted=false;for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(){
 const directory=await mkdtemp(join(tmpdir(),'drivekey-rules-test-'));dirs.push(directory);
 const wallet=Wallet.createRandom(),owner=Wallet.createRandom().address,account=Wallet.createRandom().address,registry=Wallet.createRandom().address;
 const iface=new Interface(RULES_ACCOUNT_ABI);let broadcasts=0,signatures=0;
 const provider={
  send:async()=> '0x1237',getBlock:async()=>({number:1,hash:ZeroHash}),getCode:async()=> '0x6000',
  call:async(tx:{data:string})=>{const parsed=iface.parseTransaction({data:tx.data});if(!parsed)throw Error();const values:Record<string,unknown>={registry,owner,stablecoin:ROBINHOOD_USDG_IDENTITY.token,CONTRACT_VERSION:4n,agent:wallet.address};return parsed.name in values?iface.encodeFunctionResult(parsed.name,[values[parsed.name]]):'0x';},
  getTransactionCount:async()=>0,getFeeData:async()=>({maxFeePerGas:2n,maxPriorityFeePerGas:1n}),estimateGas:async()=>100000n,
  broadcastTransaction:async(raw:string)=>{broadcasts++;return {hash:Transaction.from(raw).hash};},getTransaction:async()=>null,getTransactionReceipt:async()=>null,
 } as unknown as JsonRpcProvider;
 const signer={getAddress:async()=>wallet.address,signTransaction:async(tx:any)=>{signatures++;const intent=await readJsonFile(directory,'rules-intent-one.json') as {status:string};expect(intent.status).toBe('intent');return wallet.signTransaction(tx);}};
 const pins={account,registry,accountCodeHash:keccak256('0x6000'),registryCodeHash:keccak256('0x6000'),owner,signer:wallet.address,signerRole:'agent' as const,maxFeePerGas:5n,maxGas:500000n,maxTotalFee:1000000n,allowedSelectors:['requestPayment','executeApproved'].map(n=>iface.getFunction(n)!.selector)};
 const executor=new RulesExecutor(directory,provider,pins,signer);
 const operation={kind:'payment' as const,payment:{paymentId:'0x'+'12'.repeat(32),asset:ZeroAddress,recipient:Wallet.createRandom().address,amount:'1',category:0,expiry:2000000000}};
 return {directory,wallet,provider,signer,pins,executor,operation,counts:()=>({broadcasts,signatures})};
}
it('persists intent before signing and signed bytes before broadcast; reload never resubmits',async()=>{
 const t=await setup();const original=t.provider.broadcastTransaction.bind(t.provider);
 t.provider.broadcastTransaction=async(raw:string)=>{const saved=await t.executor.status('one');expect(saved.status).toBe('unknown');expect(saved.raw).toBe(raw);expect(saved.hash).toBe(Transaction.from(raw).hash);return original(raw);};
 await t.executor.submit('one',t.operation);expect(t.counts()).toEqual({broadcasts:1,signatures:1});
 const recovered=new RulesExecutor(t.directory,t.provider,t.pins,t.signer);
 expect((await recovered.reconcile('one')).status).toBe('unknown');
 await expect(recovered.submit('two',t.operation)).rejects.toThrow();expect(t.counts().broadcasts).toBe(1);
});
it('retains reservation and raw bytes after post-broadcast persistence failure',async()=>{
 const t=await setup();fault.submitted=true;
 await expect(t.executor.submit('one',t.operation)).rejects.toThrow('persistence');
 expect((await t.executor.status('one')).raw).toMatch(/^0x/);
 await expect(t.executor.submit('two',t.operation)).rejects.toThrow();expect(t.counts().broadcasts).toBe(1);
});
it('unknown signer outcome reserves the shared nonce and rejects concurrent requests',async()=>{
 const t=await setup();let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});
 t.signer.signTransaction=async()=>{await gate;throw Error('Unknown signer result');};
 const first=t.executor.submit('one',t.operation);const failed=expect(first).rejects.toThrow('Unknown signer');
 for(let i=0;i<100;i++){try{await t.executor.status('one');break;}catch{await new Promise(r=>setTimeout(r,10));}}
 await expect(t.executor.submit('two',t.operation)).rejects.toThrow();release();await failed;
 expect(t.counts().broadcasts).toBe(0);expect((await t.executor.status('one')).status).toBe('unknown');
});
it('rejects excess signer selectors and wrong credentials before signing',async()=>{
 const t=await setup();t.pins.allowedSelectors.push(new Interface(RULES_ACCOUNT_ABI).getFunction('applyPolicy')!.selector);
 await expect(t.executor.submit('one',t.operation)).rejects.toThrow('scope');expect(t.counts().signatures).toBe(0);
 expect(()=>authenticateRulesAgent('a'.repeat(32),'b'.repeat(32))).toThrow();expect(()=>authenticateRulesAgent('a'.repeat(32),'a'.repeat(32))).not.toThrow();
});
it('a canonical receipt without the matching payment event cannot complete or release a claim',async()=>{
 const t=await setup();const r=await t.executor.submit('one',t.operation),tx=Transaction.from(r.raw!);
 t.provider.getTransaction=async()=>Object.assign(tx,{blockHash:ZeroHash}) as any;
 t.provider.getTransactionReceipt=async()=>({hash:r.hash,blockHash:ZeroHash,blockNumber:1,status:1,logs:[]}) as any;
 await expect(t.executor.reconcile('one')).rejects.toThrow('matching payment');
 await expect(t.executor.submit('two',t.operation)).rejects.toThrow();
});
it('approval-request evidence stays distinct from payment confirmation and finality',async()=>{
 const t=await setup();const r=await t.executor.submit('one',t.operation),tx=Transaction.from(r.raw!),p=t.operation.payment,iface=new Interface(RULES_ACCOUNT_ABI);
 t.provider.getTransaction=async()=>Object.assign(tx,{blockHash:ZeroHash}) as any;
 const event=iface.encodeEventLog(iface.getEvent('ApprovalRequested')!,[p.paymentId,p.asset,p.recipient,p.amount,p.category,1,0,p.expiry]);
 t.provider.getTransactionReceipt=async()=>({hash:r.hash,blockHash:ZeroHash,blockNumber:1,status:1,logs:[{address:t.pins.account,...event}]}) as any;
 t.provider.getBlock=async(tag:any)=>({number:tag==='finalized'?0:1,hash:ZeroHash}) as any;
 const confirmed=await t.executor.reconcile('one');expect(confirmed.outcome).toBe('awaiting-offline-approval');expect(confirmed.status).toBe('confirmed');
 await expect(t.executor.submit('two',t.operation)).rejects.toThrow();
 t.provider.getBlock=async()=>({number:1,hash:ZeroHash}) as any;
 expect((await t.executor.reconcile('one')).status).toBe('finalized');
 expect((await t.executor.status('one')).outcome).toBe('awaiting-offline-approval');
});
it('a reorganized receipt never clears the nonce reservation',async()=>{
 const t=await setup();const r=await t.executor.submit('one',t.operation),tx=Transaction.from(r.raw!);
 t.provider.getTransaction=async()=>Object.assign(tx,{blockHash:ZeroHash}) as any;
 t.provider.getTransactionReceipt=async()=>({hash:r.hash,blockHash:ZeroHash,blockNumber:1,status:1,logs:[]}) as any;
 t.provider.getBlock=async()=>({number:1,hash:'0x'+'ab'.repeat(32)}) as any;
 await expect(t.executor.reconcile('one')).rejects.toThrow('canonical evidence');
 await expect(t.executor.submit('two',t.operation)).rejects.toThrow();
});
