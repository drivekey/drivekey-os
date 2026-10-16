import {z} from 'zod';
import {Interface,Transaction,ZeroAddress,parseUnits,toQuantity,keccak256,getAddress,sha256} from 'ethers';
import type {WalletSubmissionClaim,WalletSubmissionStore} from './wallet-submission-ledger';
import {multiPublicSchema} from './multi-protocol';
import type {Rpc} from './protocol';
import {LIFI_PINS} from './lifi-pins';
import {checkEthereumIdentities,ethereumIdentitiesFor} from './ethereum-contract-identity';
import {LIFI_ABI,LIFI_FEE_ABI,LIFI_USDC,LIFI_IDENTITY_DIGEST,LIFI_MAX_VALUE,LIFI_MAX_GAS_COST,decodeLifiCall,lifiFingerprint,validateLifiRequest,verifyLifiResponse,type LifiRequest} from './lifi-protocol';
import {evmEvidence} from './transaction-evidence';
export const lifiPrepareSchema=z.object({wallet:multiPublicSchema,amount:z.string().max(60).regex(/^(0|[1-9]\d*)(\.\d+)?$/),slippageBps:z.union([z.literal(25),z.literal(50),z.literal(100)])}).strict();
export const lifiSignedEnvelope=z.object({request:z.unknown(),response:z.unknown(),wallet:multiPublicSchema}).strict();
const num=(v:unknown)=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]{1,64}$/.test(v))throw Error('Invalid Ethereum response.');return BigInt(v);};
const loupe=new Interface(['function facetAddress(bytes4) view returns(address)']);
export async function checkLifiIdentities(rpc:Rpc){
 const a={kind:'payment',tokenIn:'USDC',poolFee:500} as const;
 await checkEthereumIdentities(rpc,a,ethereumIdentitiesFor(a));
 const block=await rpc('eth_getBlockByNumber',['latest',false]) as {number:string;hash:string};
 if(!block?.number||!block.hash)throw Error('Missing LI.FI identity block.');
 await Promise.all(Object.values(LIFI_PINS).map(async p=>{const code=await rpc('eth_getCode',[p.address,block.number]);if(typeof code!=='string'||code==='0x'||keccak256(code)!==p.codeHash)throw Error('LI.FI or Sushi contract changed. A reviewed signer update is required.');}));
 const raw=await rpc('eth_call',[{to:LIFI_PINS.Diamond.address,data:loupe.encodeFunctionData('facetAddress',['0x736eac0b'])},block.number]);
 if(getAddress(loupe.decodeFunctionResult('facetAddress',String(raw))[0])!==getAddress(LIFI_PINS.Facet.address))throw Error('LI.FI swap implementation changed.');
 const after=await rpc('eth_getBlockByNumber',[block.number,false]) as {hash:string};if(after?.hash!==block.hash)throw Error('Identity block changed; try again.');
 return block;
}
export async function lifiBoundedJson(response:Response,max=1000000){
 const reader=response.body?.getReader();if(!reader)throw Error('Empty response.');let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Response too large.');}text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());
}
async function nativeQuote(a:z.infer<typeof lifiPrepareSchema>,amount:bigint,fetcher:typeof fetch){
 const params=new URLSearchParams({fromChain:'1',toChain:'1',fromToken:ZeroAddress,toToken:LIFI_USDC,fromAddress:a.wallet.evmAddress,toAddress:a.wallet.evmAddress,fromAmount:String(amount),slippage:String(a.slippageBps/10000),integrator:'drivekey',fee:'0',allowExchanges:'sushiswap'});
 const response=await fetcher('https://li.quest/v1/quote?'+params,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});if(!response.ok){await response.body?.cancel();throw Error('LI.FI cannot currently build the supported ETH / USDC route.');}
 const q=z.object({id:z.string().min(1).max(200),tool:z.literal('sushiswap'),action:z.object({fromChainId:z.literal(1),toChainId:z.literal(1),fromAddress:z.string(),toAddress:z.string(),fromAmount:z.string(),slippage:z.number(),fromToken:z.object({address:z.string(),decimals:z.literal(18),chainId:z.literal(1)}),toToken:z.object({address:z.string(),decimals:z.literal(6),chainId:z.literal(1)})}),estimate:z.object({fromAmount:z.string(),toAmount:z.string().regex(/^\d{1,39}$/),toAmountMin:z.string().regex(/^\d{1,39}$/)}),transactionRequest:z.object({from:z.string(),to:z.string(),chainId:z.literal(1),value:z.string(),data:z.string().max(16000)})}).parse(await lifiBoundedJson(response));
 const ac=q.action,t=q.transactionRequest;
 if([ac.fromAddress,ac.toAddress,t.from].some(v=>getAddress(v)!==getAddress(a.wallet.evmAddress))||getAddress(t.to)!==getAddress(LIFI_PINS.Diamond.address)||getAddress(ac.fromToken.address)!==ZeroAddress||getAddress(ac.toToken.address)!==getAddress(LIFI_USDC)||ac.fromAmount!==String(amount)||q.estimate.fromAmount!==String(amount)||BigInt(t.value)!==amount||Math.abs(ac.slippage-a.slippageBps/10000)>1e-9)throw Error('LI.FI quote differs from requested trade.');
 return q;
}
export async function prepareLifi(input:unknown,rpc:Rpc,fetcher:typeof fetch=fetch,now=Date.now()){
 const a=lifiPrepareSchema.parse(input),amount=parseUnits(a.amount,18);if(amount<=0n||amount>LIFI_MAX_VALUE)throw Error('Enter up to 0.005 ETH for this release.');
 await checkLifiIdentities(rpc);
 const q=await nativeQuote(a,amount,fetcher),data=q.transactionRequest.data.toLowerCase();
 const decoded=LIFI_ABI.decodeFunctionData('swapTokensMultipleV3NativeToERC20',data),fees=LIFI_FEE_ABI.decodeFunctionData('forwardNativeFees',decoded[5][0].callData)[0];
 const providerFee=String(fees[0].amount),minimumOutput=q.estimate.toAmountMin;
 decodeLifiCall(data,a.wallet.evmAddress,amount,BigInt(minimumOutput),BigInt(providerFee));
 const call={from:a.wallet.evmAddress,to:LIFI_PINS.Diamond.address,value:toQuantity(amount),data};
 const [nonce,balance,block,tip]=await Promise.all([rpc('eth_getTransactionCount',[call.from,'pending']),rpc('eth_getBalance',[call.from,'pending']),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_maxPriorityFeePerGas')]);
 if(num(balance)<amount)throw Error('Insufficient Ethereum ETH. Fund the swap amount plus gas before preparing.');
 const gas=num(await rpc('eth_estimateGas',[call]))*12n/10n,maxPriorityFeePerGas=num(tip),maxFeePerGas=num((block as {baseFeePerGas:unknown}).baseFeePerGas)*2n+maxPriorityFeePerGas;
 if(gas*maxFeePerGas>LIFI_MAX_GAS_COST)throw Error('Maximum gas exceeds 0.001 ETH. Wait for lower fees.');
 if(num(balance)<amount+gas*maxFeePerGas)throw Error('Insufficient ETH for swap plus maximum gas.');
 if(num(nonce)>4294967295n)throw Error('Ethereum nonce out of range.');
 await rpc('eth_call',[call,'pending']);
 const r:LifiRequest={version:9,kind:'lifi-native-swap',network:'ethereum',chainId:1,requestId:crypto.randomUUID(),deviceId:a.wallet.deviceId,from:a.wallet.evmAddress,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30*60000).toISOString(),amount:String(amount),minimumOutput,quotedOutput:q.estimate.toAmount,providerFee,slippageBps:a.slippageBps,quoteId:q.id,identityDigest:LIFI_IDENTITY_DIGEST,unsignedTransaction:Transaction.from({type:2,chainId:1,to:call.to,value:amount,data,nonce:Number(num(nonce)),gasLimit:gas,maxFeePerGas,maxPriorityFeePerGas}).unsignedSerialized,fingerprint:'0x'+'00'.repeat(32)};
 r.fingerprint=lifiFingerprint(r);return validateLifiRequest(r,Date.now());
}
export async function preflightLifi(input:unknown,rpc:Rpc){
 const a=lifiSignedEnvelope.parse(input),r=validateLifiRequest(a.request),s=verifyLifiResponse(a.response,r,a.wallet),tx=Transaction.from(s.rawSignedTransaction);
 await checkLifiIdentities(rpc);
 const call={from:r.from,to:tx.to,data:tx.data,value:toQuantity(tx.value),gas:toQuantity(tx.gasLimit),maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!)};
 const [nonce,balance,block,gas]=await Promise.all([rpc('eth_getTransactionCount',[r.from,'pending']),rpc('eth_getBalance',[r.from,'pending']),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_estimateGas',[call])]);
 if(num(nonce)!==BigInt(tx.nonce))throw Error('Ethereum nonce changed. Reconcile previous transactions before preparing again.');
 if(num(balance)<tx.value+tx.gasLimit*tx.maxFeePerGas!||num(gas)>tx.gasLimit||num((block as {baseFeePerGas:unknown}).baseFeePerGas)+tx.maxPriorityFeePerGas!>tx.maxFeePerGas!)throw Error('Balance or gas conditions changed. Prepare a fresh approval.');
 await rpc('eth_call',[call,'pending']);validateLifiRequest(r);
 return {state:'ready',hash:s.transactionHash};
}
const token=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export function lifiDelivery(request:unknown,logs:unknown){
 const r=validateLifiRequest(request,Date.now(),false),tx=Transaction.from(r.unsignedTransaction),{transactionId}=decodeLifiCall(tx.data,r.from,tx.value,BigInt(r.minimumOutput),BigInt(r.providerFee));
 const list=z.array(z.object({address:z.string(),topics:z.array(z.string()),data:z.string(),removed:z.boolean().optional()})).max(1000).parse(logs);
 let delivered=0n,eventAmount=0n,eventCount=0;
 for(const log of list){if(log.removed)throw Error('Removed settlement log.');
  if(log.address.toLowerCase()===LIFI_USDC.toLowerCase()){try{const e=token.parseLog(log);if(e&&getAddress(e.args.from)===getAddress(LIFI_PINS.Diamond.address)&&getAddress(e.args.to)===getAddress(r.from))delivered+=e.args.value;}catch{/* unrelated USDC event */}}
  if(log.address.toLowerCase()===LIFI_PINS.Diamond.address.toLowerCase()){try{const e=LIFI_ABI.parseLog(log);if(e&&e.args.transactionId===transactionId&&e.args.integrator==='drivekey'&&e.args.referrer===ZeroAddress&&getAddress(e.args.receiver)===getAddress(r.from)&&getAddress(e.args.fromAssetId)===ZeroAddress&&getAddress(e.args.toAssetId)===getAddress(LIFI_USDC)&&e.args.fromAmount===tx.value){eventAmount=e.args.toAmount;eventCount++;}}catch{/* unrelated Diamond event */}}
 }
 return {verified:eventCount===1&&delivered===eventAmount&&delivered>=BigInt(r.minimumOutput),receivedBaseUnits:String(delivered)};
}
export async function lifiStatus(input:unknown,rpc:Rpc){
 const a=lifiSignedEnvelope.parse(input),r=validateLifiRequest(a.request,Date.now(),false),s=verifyLifiResponse(a.response,r,a.wallet,Date.now(),false);
 if(num(await rpc('eth_chainId'))!==1n)throw Error('Wrong Ethereum network.');
 const evidence=await evmEvidence(s.transactionHash,s.rawSignedTransaction,rpc);if(evidence.state!=='confirmed')return evidence;
 const receipt=await rpc('eth_getTransactionReceipt',[s.transactionHash]) as {transactionHash:string;blockHash:string;blockNumber:string;status:string;logs:unknown};
 if(!receipt||receipt.transactionHash.toLowerCase()!==s.transactionHash||receipt.blockHash!==evidence.evidenceBlockHash||receipt.blockNumber!==evidence.evidenceBlockNumber||receipt.status!=='0x1')throw Error('Receipt changed during verification.');
 const delivery=lifiDelivery(r,receipt.logs);return {...evidence,state:delivery.verified?'confirmed':'submitted',deliveryVerified:delivery.verified,...delivery};
}
export type LifiSubmissionRecord={version:1;chainId:1;from:string;nonce:number;hash:string;fingerprint:string};
export type LifiSubmissionStore={read(hash:string):Promise<LifiSubmissionRecord|null>;claim(record:LifiSubmissionRecord):Promise<boolean>};
function sameSubmission(a:LifiSubmissionRecord,b:LifiSubmissionRecord){return a.version===b.version&&a.chainId===b.chainId&&a.from===b.from&&a.nonce===b.nonce&&a.hash===b.hash&&a.fingerprint===b.fingerprint;}
export async function submitLifi(input:unknown,rpc:Rpc,store:LifiSubmissionStore,walletStore?:WalletSubmissionStore){
 const a=z.object({request:z.unknown(),response:z.unknown(),wallet:multiPublicSchema,consent:z.literal(true)}).strict().parse(input);
 // An expired approval may still have been broadcast. Reconcile exact bytes first.
 const s=verifyLifiResponse(a.response,a.request,a.wallet,Date.now(),false),tx=Transaction.from(s.rawSignedTransaction);
 const record:LifiSubmissionRecord={version:1,chainId:1,from:tx.from!.toLowerCase(),nonce:tx.nonce,hash:s.transactionHash,fingerprint:s.fingerprint};
 const previous=await store.read(record.hash);
 if(previous&&!sameSubmission(previous,record))throw Error('Submission journal identity differs. Reconcile before continuing.');
 const status=await lifiStatus({request:a.request,response:a.response,wallet:a.wallet},rpc);
 if(status.state!=='unknown')return status;
 if(previous)return {...status,canResubmit:false,message:'Submission was already claimed. Keep checking this hash; no automatic resend.'};
 if(!walletStore)throw Error('Shared wallet submission storage is required before broadcasting.');
 const r=validateLifiRequest(a.request,Date.now(),false);
 const shared:WalletSubmissionClaim={version:1,kind:'evm',purpose:'swap',protocolVersion:9,chainId:1,from:record.from,nonce:record.nonce,hash:record.hash,fingerprint:record.fingerprint,signedBytesDigest:sha256(s.rawSignedTransaction),expiresAt:r.expiresAt};
 const identity={family:'evm' as const,chainId:1,hash:record.hash};
 const matches=(candidate:WalletSubmissionClaim)=>Object.keys(candidate).length===Object.keys(shared).length&&Object.entries(shared).every(([key,value])=>(candidate as Record<string,unknown>)[key]===value);
 const priorWalletClaim=await walletStore.read(identity);
 if(priorWalletClaim){if(!matches(priorWalletClaim))throw Error('Shared submission journal identity differs. Reconcile before continuing.');return {...status,canResubmit:false,message:'Wallet submission already claimed. Reconcile this hash; do not resend.'};}
 await preflightLifi({request:a.request,response:a.response,wallet:a.wallet},rpc);
 // Different journals may be on different databases. A crash between claims
 // strands the intent for recovery; it never authorizes repeating a broadcast.
 if(!await walletStore.claim(shared))return {state:'unknown',hash:record.hash,canResubmit:false,message:'Wallet transaction or nonce already claimed. Reconcile saved transactions; do not resend.'};
 const savedWalletClaim=await walletStore.read(identity);
 if(!savedWalletClaim||!matches(savedWalletClaim))throw Error('Shared submission intent could not be verified in durable storage.');
 // This must be a durable atomic claim, unique for both hash and wallet nonce.
 // A rejected or uncertain claim can never authorize another broadcast.
 if(!await store.claim(record))return {state:'unknown',hash:record.hash,canResubmit:false,message:'This hash or wallet nonce was already claimed. Reconcile saved transactions; no automatic resend.'};
 const persisted=await store.read(record.hash);
 if(!persisted||!sameSubmission(persisted,record))throw Error('Submission intent could not be verified in durable storage.');
 if(Date.now()>=Date.parse(r.expiresAt))return {state:'expired',hash:record.hash,canResubmit:false,message:'Request expired before broadcast. No transaction sent by this attempt. Reconcile saved transactions before a fresh approval.'};
 try{const result=await rpc('eth_sendRawTransaction',[s.rawSignedTransaction]);if(result!==record.hash)throw Error();return {state:'submitted',hash:record.hash};}
 catch{return {state:'unknown',hash:record.hash,canResubmit:false,message:'Submission outcome unknown. Check the saved transaction hash; no automatic resend.'};}
}
