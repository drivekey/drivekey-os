// Server-only online preparation. Public data only; no signing or broadcasting.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {parseUnits} from 'ethers';
import {Connection,NonceAccount,PublicKey,SystemProgram} from '@solana/web3.js';
import {ACCOUNT_SIZE} from '@solana/spl-token';
import {SOLANA_GENESIS,multiPublicSchema} from './multi-protocol';
import {solSwapBuildSchema,solSwapExpected,solSwapFingerprint,validateSolSwap,type SolSwapRequest} from './sol-swap-protocol';
import {buildJupiterLegacyMessage,RAYDIUM_CLMM,validateJupiterAncillary} from './jupiter-account-policy';
import {checkPreparedSolSwap} from './sol-swap-online';
import {readJupiterResponse} from './jupiter-response';
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pub=z.string().max(44).refine(s=>{try{return new PublicKey(s).toBase58()===s;}catch{return false;}});
export const prepareSolSwapSchema=z.object({wallet:multiPublicSchema,tokenIn:z.enum(['SOL','USDC']),amount:z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(40),nonceAccount:pub,slippageBps:z.number().int().min(0).max(100).default(50)}).strict();
export async function prepareSolSwap(input:unknown,c:Connection,key:string|undefined,fetcher:typeof fetch=fetch){
 const a=prepareSolSwapSchema.parse(input);
 if(await c.getGenesisHash()!==SOLANA_GENESIS)throw Error('Wrong Solana network.');
 const amount=parseUnits(a.amount,a.tokenIn==='SOL'?9:6);if(amount<=0n||amount>=2n**64n)throw Error('Invalid swap amount.');
 const inputMint=a.tokenIn==='SOL'?SOL:USDC,outputMint=inputMint===SOL?USDC:SOL;
 const response=await fetcher('https://api.jup.ag/swap/v2/build?'+new URLSearchParams({inputMint,outputMint,amount:amount.toString(),taker:a.wallet.solanaAddress,slippageBps:String(a.slippageBps),dexes:'Raydium CLMM',maxAccounts:'24'}),{headers:key?{'x-api-key':key}:{},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 const payload=await readJupiterResponse(response);
 const body=z.record(z.unknown()).safeParse(payload);
 if(!body.success)throw Error('Jupiter returned an unsupported response. No transaction was prepared.');
 const checkedBuild=solSwapBuildSchema.safeParse(Object.fromEntries(Object.keys(solSwapBuildSchema.shape).map(k=>[k,body.data[k]])));
 if(!checkedBuild.success)throw Error('Jupiter returned an unsupported route or instruction layout. No transaction was prepared.');
 const build=checkedBuild.data;
 // API filters are hints. Decode and validate what actually returned.
 validateJupiterAncillary(build,{from:a.wallet.solanaAddress,inputMint,amount:amount.toString(),slippageBps:a.slippageBps});
 const nonceInfo=await c.getAccountInfo(new PublicKey(a.nonceAccount),'confirmed');
 if(!nonceInfo||nonceInfo.executable||!nonceInfo.owner.equals(SystemProgram.programId)||nonceInfo.data.length!==80||nonceInfo.data.readUInt32LE(0)!==1||nonceInfo.data.readUInt32LE(4)!==1)throw Error('Initialized current-version durable nonce required.');
 const nonce=NonceAccount.fromAccountData(nonceInfo.data);
 if(nonce.authorizedPubkey.toBase58()!==a.wallet.solanaAddress)throw Error('Nonce authority must be the signing wallet.');
 if(!Number.isSafeInteger(nonce.feeCalculator.lamportsPerSignature))throw Error('Invalid nonce fee.');
 const pool=new PublicKey(build.routePlan[0].swapInfo.ammKey),program=new PublicKey(RAYDIUM_CLMM);
 const bitmap=PublicKey.findProgramAddressSync([Buffer.from('pool_tick_array_bitmap_extension'),pool.toBuffer()],program)[0].toBase58();
 const ticks=build.swapInstruction.accounts.slice(20,-1).filter(m=>m.pubkey!==bitmap);
 if(ticks.length<1||ticks.length>4)throw Error('Unsupported tick-array count.');
 const accounts=await c.getMultipleAccountsInfo(ticks.map(m=>new PublicKey(m.pubkey)),'confirmed');
 const discriminator=createHash('sha256').update('account:TickArrayState').digest().subarray(0,8),tickStarts:Record<string,number>={};
 for(let i=0;i<ticks.length;i++){
  const info=accounts[i];
  if(!info||info.executable||!info.owner.equals(program)||info.data.length<44||!info.data.subarray(0,8).equals(discriminator)||!info.data.subarray(8,40).equals(pool.toBuffer()))throw Error('Tick array identity is unsupported.');
  tickStarts[ticks[i].pubkey]=info.data.readInt32LE(40);
 }
 const rent=await c.getMinimumBalanceForRentExemption(ACCOUNT_SIZE,'confirmed');if(!Number.isSafeInteger(rent)||rent<0)throw Error('Invalid account rent.');
 const now=Date.now(),r:SolSwapRequest={version:4,network:'solana',kind:'swap',genesisHash:SOLANA_GENESIS,requestId:crypto.randomUUID(),deviceId:a.wallet.deviceId,from:a.wallet.solanaAddress,createdAt:new Date(now).toISOString(),expiresAt:new Date(Math.floor((now+1800000)/1000)*1000).toISOString(),nonceAccount:a.nonceAccount,nonceValue:nonce.nonce,nonceFee:String(nonce.feeCalculator.lamportsPerSignature),tokenAccountRent:String(rent),build,tickStarts,unsignedMessage:'',fingerprint:'0x'+'00'.repeat(32)};
 r.unsignedMessage=Buffer.from(buildJupiterLegacyMessage(build,solSwapExpected(r),tickStarts,r.nonceAccount,r.nonceValue).serialize()).toString('base64');r.fingerprint=solSwapFingerprint(r);
 validateSolSwap(r);const checked=await checkPreparedSolSwap(r,c);
 return {state:'prepared',request:validateSolSwap(r),broadcastEnabled:false,...checked};
}
