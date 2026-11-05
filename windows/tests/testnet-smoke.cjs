// Explicitly testnet-only. Never reads user vaults or submits on Ethereum/mainnet.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {OnlineAdapter}=require('../dist/adapter.cjs'),{verifyPaymentResponse}=require('../dist/payment.cjs');
const root=path.resolve(__dirname,'..'),work=path.resolve(root,'../../work/testnet-'+Date.now()),password='Disposable generated testnet vault credential 2026!';
async function job(input){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--no-addons',path.join(root,'dist/worker.cjs')],{stdio:['pipe','pipe','ignore'],windowsHide:true});let result='';child.stdout.on('data',b=>{result+=b;if(result.length>256*1024)child.kill();});child.on('error',reject);child.on('exit',code=>{try{const r=JSON.parse(result);if(code||!r.ok)throw Error('Worker rejected operation.');resolve(r.result);}catch{reject(Error('Worker rejected operation.'));}});child.stdin.end(JSON.stringify(input));});}
async function run(){await fs.mkdir(work,{recursive:true});const evidence={checkedAt:new Date().toISOString(),mainnetTransactions:0,ethereum:{chain:'sepolia'},solana:{chain:'devnet'},limitations:['No mainnet funds or user wallets used. Testnet coins have no monetary value. USDC faucet credentials remain unavailable.']},a=new OnlineAdapter({sepolia:'https://ethereum-sepolia-rpc.publicnode.com',devnet:'https://api.devnet.solana.com'});
 try{await a.identity('sepolia');evidence.ethereum.rpcIdentityVerified=true;}catch{evidence.ethereum.rpcIdentityVerified=false;}
 try{
  await a.identity('devnet');evidence.solana.rpcIdentityVerified=true;const sender=await job({action:'create',password}),recipient=await job({action:'create',password});
  await fs.writeFile(path.join(work,'sender-encrypted.json'),JSON.stringify(sender),{flag:'wx',mode:0o600});await fs.writeFile(path.join(work,'recipient-encrypted.json'),JSON.stringify(recipient),{flag:'wx',mode:0o600});
  evidence.solana.sender=sender.public.solanaAddress;evidence.solana.recipient=recipient.public.solanaAddress;
  const funding=await a.rpc('devnet','requestAirdrop',[sender.public.solanaAddress,10000000]);evidence.solana.airdropSignature=funding;
  let balance=0n;for(let n=0;n<10;n++){balance=BigInt((await a.balance('devnet',sender.public.solanaAddress,'SOL')).amount);if(balance>=10000n)break;await new Promise(r=>setTimeout(r,1000));}
  if(balance<10000n)throw Error('Airdrop did not settle.');
  const request=await a.prepare({chain:'devnet',asset:'SOL',amount:'1000000',recipient:recipient.public.solanaAddress},sender.public);await a.preflight(request);const response=await job({action:'sign',vault:sender,password,request,fingerprint:request.fingerprint});verifyPaymentResponse(response,request,sender.public);await a.preflight(request);
  // Durable approved payload before any submission; unknown results are never retried.
  await fs.writeFile(path.join(work,'approved-testnet-payment.json'),JSON.stringify({state:'submitting',request,response}),{flag:'wx',mode:0o600});
  evidence.solana.transactionHash=response.transactionHash;evidence.solana.amountLamports='1000000';evidence.solana.maximumFeeLamports=request.maximumFee;
  try{await a.broadcast(request,response);evidence.solana.submitted=true;}catch{evidence.solana.submissionUncertain=true;}
  evidence.solana.settlement=await a.reconcile(request,response);
 }catch(error){evidence.solana.completed=false;evidence.solana.reason=error.message.slice(0,240);evidence.solana.livePass=false;}
 await fs.writeFile(path.join(root,'verification','TESTNET-SMOKE.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}run().catch(()=>{console.error('Testnet smoke failed without mainnet fallback.');process.exitCode=1;});
