import {z} from 'zod';
import {Interface,Transaction,ZeroAddress,getAddress,keccak256,verifyMessage,formatUnits} from 'ethers';
import {multiPublicSchema} from './multi-protocol';
import {LIFI_PINS} from './lifi-pins';
import {ETHEREUM_IDENTITIES} from './ethereum-contract-identity';
export const LIFI_USDC=ETHEREUM_IDENTITIES.USDC.address;
export const LIFI_NATIVE='0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const LIFI_ABI=new Interface([
 'function swapTokensMultipleV3NativeToERC20(bytes32,string,string,address,uint256,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]) payable',
 'event LiFiGenericSwapCompleted(bytes32 indexed transactionId,string integrator,string referrer,address receiver,address fromAssetId,address toAssetId,uint256 fromAmount,uint256 toAmount)',
]);
export const LIFI_FEE_ABI=new Interface(['function forwardNativeFees((address recipient,uint256 amount)[]) payable']);
export const LIFI_SUSHI_ABI=new Interface(['function snwap(address,uint256,address,address,uint256,address,bytes) payable returns(uint256)']);
export const LIFI_MAX_VALUE=5_000_000_000_000_000n,LIFI_MAX_GAS_COST=1_000_000_000_000_000n;
const quantity=z.string().max(39).regex(/^(0|[1-9]\d*)$/).refine(v=>BigInt(v)<2n**128n);
const hex=z.string().max(20000).regex(/^0x(?:[0-9a-f]{2})+$/);
const digest=z.string().regex(/^0x[0-9a-f]{64}$/);
const address=z.string().refine(v=>{try{return getAddress(v)!==ZeroAddress;}catch{return false;}});
export const lifiRequestSchema=z.object({version:z.literal(9),kind:z.literal('lifi-native-swap'),network:z.literal('ethereum'),chainId:z.literal(1),
 requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),from:address,
 amount:quantity,minimumOutput:quantity,quotedOutput:quantity,providerFee:quantity,slippageBps:z.union([z.literal(25),z.literal(50),z.literal(100)]),
 quoteId:z.string().min(1).max(200),identityDigest:digest,unsignedTransaction:hex,fingerprint:digest}).strict();
export type LifiRequest=z.infer<typeof lifiRequestSchema>;
export const lifiResponseSchema=z.object({version:z.literal(9),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:digest,signedAt:z.string().datetime(),rawSignedTransaction:hex,approvalSignature:z.string().regex(/^0x[0-9a-f]{130}$/),transactionHash:digest}).strict();
export type LifiResponse=z.infer<typeof lifiResponseSchema>;
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)]));return v;}
const hash=(v:unknown)=>keccak256(new TextEncoder().encode(JSON.stringify(canonical(v))));
export const LIFI_IDENTITY_DIGEST=hash({pins:LIFI_PINS,usdc:ETHEREUM_IDENTITIES.USDC});
export const lifiFingerprint=(r:Omit<LifiRequest,'fingerprint'>|LifiRequest)=>hash(['DriveKey LI.FI native swap v9',Object.fromEntries(Object.entries(r).filter(([k])=>k!=='fingerprint'))]);
export const lifiApproval=(r:LifiRequest)=>'DriveKey LI.FI native swap approval v9\n'+r.fingerprint;
const same=(a:string,b:string)=>getAddress(a)===getAddress(b);
function requireThat(ok:boolean,message:string){if(!ok)throw Error(message);}
function decodeCanonical(abi:Interface,name:string,data:string){const d=abi.decodeFunctionData(name,data);requireThat(abi.encodeFunctionData(name,d).toLowerCase()===data.toLowerCase(),'Noncanonical LI.FI calldata.');return d;}
// Native-only: no ERC20 approvals or wallet transferFrom calls. Two independently
// pinned output guards bind canonical USDC to the Diamond, then to the owner.
export function decodeLifiCall(data:string,owner:string,amount:bigint,minimum:bigint,fee:bigint){
 const d=decodeCanonical(LIFI_ABI,'swapTokensMultipleV3NativeToERC20',data),swaps=d[5];
 requireThat(d[1]==='drivekey'&&d[2]===ZeroAddress&&same(d[3],owner)&&d[4]===minimum,'LI.FI recipient or minimum differs from approval.');
 requireThat(swaps.length===2,'Unsupported LI.FI route.');
 const f=swaps[0],s=swaps[1];
 requireThat(same(f.callTo,LIFI_PINS.FeeForwarder.address)&&same(f.approveTo,f.callTo)&&same(f.sendingAssetId,ZeroAddress)&&same(f.receivingAssetId,ZeroAddress)&&f.fromAmount===amount&&f.requiresDeposit===true,'Unsupported LI.FI fee call.');
 const fees=decodeCanonical(LIFI_FEE_ABI,'forwardNativeFees',f.callData)[0];
 requireThat(fees.length===1&&same(fees[0].recipient,'0xc06ebbefd94032b85424d51906e2a335efae264b')&&fees[0].amount===fee&&fee>0n&&fee*10000n<=amount*25n,'LI.FI fee exceeds the 0.25% cap or uses a different recipient.');
 requireThat(same(s.callTo,LIFI_PINS.Sushi.address)&&same(s.approveTo,s.callTo)&&same(s.sendingAssetId,ZeroAddress)&&same(s.receivingAssetId,LIFI_USDC)&&s.fromAmount===amount-fee&&s.requiresDeposit===false,'Unsupported LI.FI swap call.');
 const swap=decodeCanonical(LIFI_SUSHI_ABI,'snwap',s.callData);
 requireThat(same(swap[0],LIFI_NATIVE)&&swap[1]===amount-fee&&same(swap[2],LIFI_PINS.Diamond.address)&&same(swap[3],LIFI_USDC)&&swap[4]>=minimum&&same(swap[5],LIFI_PINS.Executor.address),'Sushi amount, recipient, executor or minimum differs from approval.');
 requireThat(typeof swap[6]==='string'&&swap[6].length<=12000&&swap[6].startsWith('0x6be92b89'),'Unsupported Sushi executor payload.');
 return {transactionId:String(d[0]),routeHash:keccak256(swap[6])};
}
export function validateLifiRequest(input:unknown,now=Date.now(),checkExpiry=true):LifiRequest{
 const r=lifiRequestSchema.parse(input),tx=Transaction.from(r.unsignedTransaction),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 requireThat(Number.isSafeInteger(now)&&created<=now+60000&&expires>created&&expires-created<=30*60000,'Invalid LI.FI approval window.');
 if(checkExpiry)requireThat(now<expires,'LI.FI approval expired. Prepare a fresh request.');
 requireThat(r.identityDigest===LIFI_IDENTITY_DIGEST,'LI.FI signer identities differ. Update the offline signer.');
 const amount=BigInt(r.amount),minimum=BigInt(r.minimumOutput),quoted=BigInt(r.quotedOutput);
 requireThat(amount>0n&&amount<=LIFI_MAX_VALUE&&minimum>0n&&minimum<=quoted&&minimum*10000n>=quoted*BigInt(10000-r.slippageBps)-10000n,'Invalid LI.FI amount or slippage.');
 requireThat(!tx.signature&&tx.type===2&&tx.chainId===1n&&!!tx.to&&same(tx.to,LIFI_PINS.Diamond.address)&&tx.value===amount&&!tx.accessList?.length&&!tx.authorizationList?.length&&tx.unsignedSerialized===r.unsignedTransaction,'LI.FI transaction differs from approval.');
 requireThat(tx.gasLimit>=21000n&&tx.gasLimit<=1000000n&&!!tx.maxFeePerGas&&tx.maxPriorityFeePerGas!==null&&tx.maxPriorityFeePerGas>=0n&&tx.maxPriorityFeePerGas<=tx.maxFeePerGas&&tx.gasLimit*tx.maxFeePerGas<=LIFI_MAX_GAS_COST,'LI.FI gas budget exceeds the supported cap.');
 decodeLifiCall(tx.data,r.from,amount,minimum,BigInt(r.providerFee));
 requireThat(lifiFingerprint(r)===r.fingerprint,'LI.FI request fingerprint mismatch.');return r;
}
export function verifyLifiResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),checkExpiry=true){
 const r=validateLifiRequest(request,now,checkExpiry),w=multiPublicSchema.parse(wallet),s=lifiResponseSchema.parse(input),tx=Transaction.from(s.rawSignedTransaction);
 requireThat(w.deviceId===r.deviceId&&same(w.evmAddress,r.from)&&s.deviceId===r.deviceId&&s.requestId===r.requestId&&s.fingerprint===r.fingerprint&&tx.unsignedSerialized===r.unsignedTransaction&&!!tx.from&&same(tx.from,r.from)&&tx.hash===s.transactionHash&&same(verifyMessage(lifiApproval(r),s.approvalSignature),r.from),'Signed response does not match the LI.FI approval.');
 requireThat(Date.parse(s.signedAt)>=Date.parse(r.createdAt)-60000&&Date.parse(s.signedAt)<Date.parse(r.expiresAt)&&Date.parse(s.signedAt)<=now+60000,'Invalid LI.FI signing time.');return s;
}
export function lifiReview(input:unknown,checkExpiry=true){
 const r=validateLifiRequest(input,Date.now(),checkExpiry),tx=Transaction.from(r.unsignedTransaction);
 return {action:'swap',network:'Ethereum mainnet · chain 1',requiredSigner:'LI.FI native swap · approval version 9',provider:'LI.FI / Sushi',from:r.from,recipient:r.from,
 amount:formatUnits(r.amount,18)+' ETH',minimumReceived:formatUnits(r.minimumOutput,6)+' USDC',estimatedReceived:formatUnits(r.quotedOutput,6)+' USDC',outputContract:LIFI_USDC,
 providerFee:formatUnits(r.providerFee,18)+' ETH (included)',maximumGas:formatUnits(tx.gasLimit*tx.maxFeePerGas!,18)+' ETH (additional)',maximumTotal:formatUnits(tx.value+tx.gasLimit*tx.maxFeePerGas!,18)+' ETH',
 router:LIFI_PINS.Diamond.address,nonce:String(tx.nonce),gasLimit:String(tx.gasLimit),maxFeePerGasWei:String(tx.maxFeePerGas),maxPriorityFeePerGasWei:String(tx.maxPriorityFeePerGas),expiresAt:r.expiresAt,fingerprint:r.fingerprint,contractIdentities:r.identityDigest,
 slippageBps:String(r.slippageBps),approval:'No token allowance requested',
 routerCodeHash:LIFI_PINS.Diamond.codeHash,facet:LIFI_PINS.Facet.address,facetCodeHash:LIFI_PINS.Facet.codeHash,
 feeForwarder:LIFI_PINS.FeeForwarder.address,feeForwarderCodeHash:LIFI_PINS.FeeForwarder.codeHash,
 sushiRouter:LIFI_PINS.Sushi.address,sushiRouterCodeHash:LIFI_PINS.Sushi.codeHash,
 executor:LIFI_PINS.Executor.address,executorCodeHash:LIFI_PINS.Executor.codeHash,
 safeExecutor:LIFI_PINS.SafeExecutor.address,safeExecutorCodeHash:LIFI_PINS.SafeExecutor.codeHash,
 identityWarning:'Expected signer pins, not live chain observations. Online preflight must recheck deployed code and selector-to-facet routing; this offline display cannot authenticate current deployment state.',
 warning:'30-minute DriveKey approval window. No on-chain deadline: expiry cannot revoke signed bytes. Output is protected by the signed minimum; pool routing is delegated to the pinned Sushi executor. No token allowance is requested.'};
}
