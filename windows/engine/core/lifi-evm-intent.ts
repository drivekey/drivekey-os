import {z} from 'zod';
import {Interface,Transaction,getAddress,keccak256,verifyMessage,formatUnits,ZeroAddress} from 'ethers';
import {canonical,CHAINS} from './payment-intent';
export const LIFI_EVM={
 diamond:{address:'0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',codeHash:'0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220'},
 facet:{address:'0x02Db8a1c2170AEE6cd17715EcD1c567C9B296E2c',codeHash:'0xe014807aa0af9c5f735ccb002e1a54ae9152986b5f17143ba7c0c52899545040'},
 feeForwarder:{address:'0xDe2b920506EE931a6A2ABDF566526220214FBbAE',codeHash:'0x99a76627aece8903612e0246c10f13a46e511a0a074d9a4e68987a28c78ebd52'},
 oneInch:{address:'0x111111125421cA6dc452d289314280a0f8842A65',codeHash:'0xa5a286be4b80006cc547d7e899871aa01a0e0551e2a509233375405f92098c2f'},
 executor:{address:'0x111116058b9828CdCDD810c502B925c14F34CA11',codeHash:'0x2745fc61ad27554b0c6862415d2840379d8168e07c59b31871989048a0947bc1'},
 feeRecipient:'0xC06ebbefD94032B85424D51906e2A335EFAe264B',nativeSentinel:getAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
} as const;
export const LEGACY_LIFI_FEE_FORWARDER={address:'0xCE40449B773a3E6E5e769ADb4e567179d4828cbd',codeHash:'0x7ee455a6853068874bfd201f93d6383ed6d88934a922316db5575b057e2ebe74'} as const;
export type LifiFeeForwarderPin=typeof LIFI_EVM.feeForwarder|typeof LEGACY_LIFI_FEE_FORWARDER;
export function lifiFeeForwarderPin(address:string,allowLegacy=false):LifiFeeForwarderPin{
 if(address===LIFI_EVM.feeForwarder.address)return LIFI_EVM.feeForwarder;
 if(allowLegacy&&address===LEGACY_LIFI_FEE_FORWARDER.address)return LEGACY_LIFI_FEE_FORWARDER;
 throw Error('Unreviewed LI.FI fee forwarder.');
}
export const LIFI_ROUTER=new Interface([
 'function swapTokensMultipleV3NativeToERC20(bytes32 transactionId,string integrator,string referrer,address receiver,uint256 minAmountOut,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swapData) payable',
 'function swapTokensMultipleV3ERC20ToNative(bytes32 transactionId,string integrator,string referrer,address receiver,uint256 minAmountOut,(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swapData)',
 'function facetAddress(bytes4) view returns(address)',
 'event LiFiGenericSwapCompleted(bytes32 indexed transactionId,string integrator,string referrer,address receiver,address fromAssetId,address toAssetId,uint256 fromAmount,uint256 toAmount)'
]);
export const LIFI_FEE=new Interface(['function forwardNativeFees((address recipient,uint256 amount)[] fees) payable','function forwardERC20Fees(address token,(address recipient,uint256 amount)[] fees)']);
export const ONE_INCH=new Interface(['function swap(address executor,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data) payable returns(uint256 returnAmount,uint256 spentAmount)']);
export const LIFI_TOKEN=new Interface(['function approve(address spender,uint256 value) returns(bool)','function allowance(address owner,address spender) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/).max(39),hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const schema=z.object({version:z.literal(12),action:z.enum(['swap','approve','revoke']),provider:z.literal('lifi-1inch'),chain:z.literal('ethereum'),network:z.literal('ethereum'),requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),from:z.string(),recipient:z.string(),tokenIn:z.enum(['ETH','USDC']),tokenOut:z.enum(['ETH','USDC']),amount:uint,quotedOutput:uint,minimumOutput:uint,slippageBps:z.number().int().min(0).max(100),protocolFee:uint,transactionId:hash,maximumFee:uint,unsignedTransaction:z.string().max(40000),fingerprint:hash}).strict();
export type LifiEvmIntent=z.infer<typeof schema>;
export const lifiEvmFingerprint=(input:any)=>{const {fingerprint,...body}=input;return keccak256(new TextEncoder().encode('DriveKey LI.FI EVM intent v12\n'+canonical(body)));};
export const lifiEvmApproval=(r:LifiEvmIntent)=>'DriveKey LI.FI EVM approval v12\n'+r.fingerprint;
function parsed(abi:Interface,data:string){const call=abi.parseTransaction({data}),encoded=call?abi.encodeFunctionData(call.fragment,call.args):'';
 // LI.FI's fixed four-byte 1inch attribution follows the complete ABI payload.
 // It is outside the router's dynamic execution bytes, never forwarded to the
 // executor. No other trailing bytes or alternative ABI offsets are accepted.
 if(!call||(encoded!==data&&!(abi===ONE_INCH&&data===encoded+'2a94d114')))throw Error('Unknown or noncanonical integration payload.');return call;}
export function inspectLifiEvm(data:string,r:Pick<LifiEvmIntent,'tokenIn'|'tokenOut'|'amount'|'recipient'|'minimumOutput'|'protocolFee'|'transactionId'>,allowLegacy=false){
 const native=r.tokenIn==='ETH',input=native?ZeroAddress:CHAINS.ethereum.usdc,output=native?CHAINS.ethereum.usdc:ZeroAddress,c=parsed(LIFI_ROUTER,data),a=c.args;
 if(c.name!==(native?'swapTokensMultipleV3NativeToERC20':'swapTokensMultipleV3ERC20ToNative')||a.transactionId!==r.transactionId||a.integrator!=='DriveKey'||a.referrer!==ZeroAddress||a.receiver!==getAddress(r.recipient)||a.minAmountOut!==BigInt(r.minimumOutput)||a.swapData.length!==2)throw Error('Unreviewed LI.FI route, recipient or minimum.');
 const [fee,swap]=a.swapData;
 const feeForwarder=lifiFeeForwarderPin(fee.callTo,allowLegacy);
 if(fee.approveTo!==fee.callTo||fee.sendingAssetId!==input||fee.receivingAssetId!==input||fee.fromAmount!==BigInt(r.amount)||fee.requiresDeposit!==true||swap.callTo!==LIFI_EVM.oneInch.address||swap.approveTo!==swap.callTo||swap.sendingAssetId!==input||swap.receivingAssetId!==output||swap.fromAmount!==BigInt(r.amount)-BigInt(r.protocolFee)||swap.requiresDeposit!==false)throw Error('Unreviewed LI.FI target, token, permission or input.');
 const f=parsed(LIFI_FEE,fee.callData),fees=f.args.fees;
 if(f.name!==(native?'forwardNativeFees':'forwardERC20Fees')||(!native&&f.args.token!==CHAINS.ethereum.usdc)||fees.length!==1||fees[0].recipient!==LIFI_EVM.feeRecipient||fees[0].amount!==BigInt(r.protocolFee)||BigInt(r.protocolFee)<=0n||BigInt(r.protocolFee)*10000n>BigInt(r.amount)*25n)throw Error('Unreviewed LI.FI protocol fee.');
 const inner=parsed(ONE_INCH,swap.callData),d=inner.args.desc;
 // The pinned router enforces these bounds after executing its route bytes. No
 // permit, partial fill, extra native value or caller-controlled wallet delegate.
 if(inner.name!=='swap'||inner.args.executor!==LIFI_EVM.executor.address||d.srcToken!==(native?LIFI_EVM.nativeSentinel:input)||d.dstToken!==(native?output:LIFI_EVM.nativeSentinel)||d.srcReceiver!==LIFI_EVM.executor.address||d.dstReceiver!==LIFI_EVM.diamond.address||d.amount!==swap.fromAmount||d.minReturnAmount<=0n||d.minReturnAmount>BigInt(r.minimumOutput)||d.minReturnAmount+1n<BigInt(r.minimumOutput)||d.flags!==0n||inner.args.data==='0x'||inner.args.data.length>20000)throw Error('Unreviewed 1inch router bounds or permissions.');
 return {transactionId:r.transactionId,protocolFee:r.protocolFee,routeDataHash:keccak256(inner.args.data),executor:LIFI_EVM.executor.address,minimumOutput:r.minimumOutput,feeForwarder};
}
export function validateLifiEvm(input:unknown,now=Date.now(),expiry=true):LifiEvmIntent{
 const r=schema.parse(input),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 if(!Number.isSafeInteger(now)||created>now+60000||expires<=created||expires-created>300000||(expiry&&now>=expires)||r.fingerprint!==lifiEvmFingerprint(r)||r.tokenIn===r.tokenOut||getAddress(r.from)===ZeroAddress||getAddress(r.recipient)===ZeroAddress)throw Error('Invalid LI.FI identity, time or fingerprint.');
 const tx=Transaction.from(r.unsignedTransaction);
 if(tx.signature||tx.type!==2||tx.chainId!==1n||tx.unsignedSerialized!==r.unsignedTransaction||tx.accessList?.length||tx.authorizationList?.length||tx.gasLimit<21000n||tx.gasLimit>1000000n||tx.nonce>4294967295||!tx.maxFeePerGas||tx.maxPriorityFeePerGas===null||tx.maxPriorityFeePerGas>tx.maxFeePerGas||tx.gasLimit*tx.maxFeePerGas!==BigInt(r.maximumFee)||BigInt(r.maximumFee)>10n**16n)throw Error('Invalid LI.FI transaction chain, fee or permission.');
 if(r.action==='swap'){
  if(BigInt(r.amount)<=0n||BigInt(r.minimumOutput)<=0n||BigInt(r.minimumOutput)>BigInt(r.quotedOutput)||BigInt(r.minimumOutput)*10000n<BigInt(r.quotedOutput)*BigInt(10000-r.slippageBps)||tx.to!==LIFI_EVM.diamond.address||tx.value!==(r.tokenIn==='ETH'?BigInt(r.amount):0n))throw Error('Invalid LI.FI swap amount, target or slippage.');
  inspectLifiEvm(tx.data,r,!expiry);
 }else if(r.tokenIn!=='USDC'||r.recipient!==r.from||r.quotedOutput!=='0'||r.minimumOutput!=='0'||r.protocolFee!=='0'||r.slippageBps!==0||(r.action==='approve'?BigInt(r.amount)<=0n:r.amount!=='0')||tx.to!==CHAINS.ethereum.usdc||tx.value!==0n||tx.data!==LIFI_TOKEN.encodeFunctionData('approve',[LIFI_EVM.diamond.address,r.amount]))throw Error('Unreviewed LI.FI bounded approval.');
 return r;
}
export function assertLifiEvmWallet(r:LifiEvmIntent,w:any){if(r.deviceId!==w.deviceId||getAddress(r.from)!==getAddress(w.evmAddress))throw Error('LI.FI request belongs to a different wallet.');}
const response=z.object({version:z.literal(12),deviceId:z.string().uuid(),requestId:z.string().uuid(),fingerprint:hash,signedAt:z.string().datetime(),rawSignedTransaction:z.string().max(41000),transactionHash:hash,approvalSignature:z.string().max(160)}).strict();
export function verifyLifiEvmResponse(input:unknown,request:unknown,w:any,now=Date.now(),expiry=true){const r=validateLifiEvm(request,now,expiry),s=response.parse(input);assertLifiEvmWallet(r,w);const tx=Transaction.from(s.rawSignedTransaction),signed=Date.parse(s.signedAt);if(s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint||signed< Date.parse(r.createdAt)-60000||signed>=Date.parse(r.expiresAt)||signed>now+60000||tx.from!==getAddress(r.from)||tx.hash!==s.transactionHash||tx.unsignedSerialized!==r.unsignedTransaction||getAddress(verifyMessage(lifiEvmApproval(r),s.approvalSignature))!==getAddress(r.from))throw Error('Signed LI.FI transaction differs from approval.');return s;}
export function lifiEvmReview(input:unknown,now=Date.now(),expiry=true){const r=validateLifiEvm(input,now,expiry),tx=Transaction.from(r.unsignedTransaction);return {action:r.action,provider:r.provider,chain:r.chain,from:r.from,recipient:r.recipient,tokenIn:r.tokenIn,tokenOut:r.tokenOut,amount:r.amount,formattedInput:formatUnits(r.amount,r.tokenIn==='USDC'?6:18)+' '+r.tokenIn,minimumOutput:r.minimumOutput,quotedOutput:r.quotedOutput,protocolFee:r.protocolFee,maximumFeeBaseUnits:r.maximumFee,spender:LIFI_EVM.diamond.address,transactionTarget:tx.to!,nonce:String(tx.nonce),slippageBps:String(r.slippageBps),fingerprint:r.fingerprint,deadlineUTC:r.expiresAt,onchainDeadline:'None; application expiry cannot revoke an existing Ethereum signature.',routeDataHash:r.action==='swap'?inspectLifiEvm(tx.data,r,!expiry).routeDataHash:'None'};}
