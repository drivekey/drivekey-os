'use strict';
// Real unfunded crypto and a real elapsed deadline. The esbuild-only adapter
// delays key delivery/crypto completion; production has no testing hook.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {Wallet,Transaction}=require('ethers'),web3=require('@solana/web3.js'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),hook=Symbol.for('DriveKey test delayed key delivery');
let api,vault,directory,active,password=randomBytes(48).toString('base64');
const waitUntil=async deadline=>{while(Date.now()<=deadline)await new Promise(resolve=>setTimeout(resolve,Math.min(50,deadline-Date.now()+1)));};
before(async()=>{
 directory=await fs.mkdtemp(path.join(root,'verification/deadline-'));
 const result=await esbuild.build({stdin:{contents:"export * from './engine/offline-signer/payment';export * from './engine/offline-signer/multi-vault';export * from './engine/core/payment-intent';",resolveDir:root,loader:'ts'},bundle:true,packages:'external',platform:'node',format:'cjs',write:false,
  plugins:[{name:'delay-real-unlock-only-in-test',setup(build){
   build.onResolve({filter:/^\.\/multi-vault$/},args=>args.importer.endsWith('payment.ts')?{path:'delayed-unlock',namespace:'deadline-test'}:undefined);
   build.onLoad({filter:/.*/,namespace:'deadline-test'},()=>({contents:`import {unlockMultiVault as actual} from ${JSON.stringify(path.join(root,'engine/offline-signer/multi-vault.ts'))};export async function unlockMultiVault(...args){const keys=await actual(...args);return globalThis[Symbol.for('DriveKey test delayed key delivery')](keys);}`,resolveDir:root,loader:'ts'}));
  }}]});
 const file=path.join(directory,'signer.cjs');await fs.writeFile(file,result.outputFiles[0].contents);api=require(file);vault=await api.createMultiVault(password);
 globalThis[hook]=async keys=>{
  const sign=keys.evm.signTransaction.bind(keys.evm),approve=keys.evm.signMessage.bind(keys.evm);
  keys.evm.signTransaction=async tx=>{active.transactions++;const raw=await sign(tx);active.raw=raw;if(active.mode==='transaction')await waitUntil(active.deadline);return raw;};
  keys.evm.signMessage=async message=>{const signature=await approve(message);if(active.mode==='approval')await waitUntil(active.deadline);return signature;};
  if(active.mode==='unlock')await waitUntil(active.deadline);
  return keys;
 };
});
after(()=>{delete globalThis[hook];password='';});
function request(chain,asset){
 const now=Date.now(),sol=chain==='solana',recipient=sol?web3.Keypair.generate().publicKey.toBase58():Wallet.createRandom().address;
 const r={version:8,action:'payment',requestId:randomUUID(),deviceId:vault.public.deviceId,chain,network:sol?'solana':'ethereum',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+3000).toISOString(),from:sol?vault.public.solanaAddress:vault.public.evmAddress,recipient,asset,amount:'1',maximumFee:sol?'5000':'21000',accountRent:sol&&asset==='USDC'?'2039280':'0',createRecipientAccount:sol&&asset==='USDC',blockhash:sol?web3.Keypair.generate().publicKey.toBase58():null,lastValidBlockHeight:sol?1000:null};
 r.unsignedTransaction=sol?api.solPayment(r).serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'):Transaction.from({type:2,chainId:1,nonce:0,to:asset==='ETH'?recipient:api.CHAINS.ethereum.usdc,value:asset==='ETH'?1n:0n,data:asset==='ETH'?'0x':api.ERC20_PAYMENT.encodeFunctionData('transfer',[recipient,1n]),gasLimit:21000n,maxFeePerGas:1n,maxPriorityFeePerGas:0n}).unsignedSerialized;
 r.fingerprint=api.paymentFingerprint(r);return r;
}
for(const [chain,asset]of [['ethereum','ETH'],['ethereum','USDC'],['solana','SOL'],['solana','USDC']])test(`retains exact ${chain} ${asset} bytes when real signing completes before delivery after expiry`,async()=>{
 const r=request(chain,asset);active={mode:'transaction',deadline:Date.parse(r.expiresAt)+20,transactions:0};
 const original=web3.Transaction.prototype.sign;
 if(chain==='solana')web3.Transaction.prototype.sign=function(...keys){const value=original.apply(this,keys);active.transactions++;active.raw=this.serialize().toString('base64');while(Date.now()<=active.deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(50,active.deadline-Date.now()+1));return value;};
 let s;try{s=await api.signPayment(vault,password,r,r.fingerprint);}finally{web3.Transaction.prototype.sign=original;}
 assert.equal(active.transactions,1);assert.ok(Date.now()>Date.parse(r.expiresAt));assert.ok(Date.parse(s.signedAt)<Date.parse(r.expiresAt));assert.equal(s.rawSignedTransaction,active.raw);
 assert.deepEqual(api.verifyPaymentResponse(s,r,vault.public,Date.now(),false),s);
 assert.throws(()=>api.verifyPaymentResponse(s,r,vault.public),/expired/);
 await assert.rejects(api.signPayment(vault,password,r,r.fingerprint),/expired/);assert.equal(active.transactions,1);
});
for(const mode of ['unlock','approval'])test(`expiry during ${mode} creates no transferable transaction`,async()=>{
 const r=request('ethereum','ETH');active={mode,deadline:Date.parse(r.expiresAt)+20,transactions:0};
 await assert.rejects(api.signPayment(vault,password,r,r.fingerprint),/expired/);assert.equal(active.transactions,0);assert.equal(active.raw,undefined);
});
