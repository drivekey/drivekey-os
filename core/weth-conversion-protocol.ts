import {z} from 'zod';
import {Interface,Transaction,getAddress,keccak256,verifyMessage,formatUnits} from 'ethers';
import {multiPublicSchema} from './multi-protocol';
import {ETHEREUM_IDENTITIES} from './ethereum-contract-identity';

// Separate draft format. Existing v4/v7 trade codecs never accept these files.
export const WETH_CONVERSION_FILES={request:'unsigned-weth-conversion.json',response:'signed-weth-conversion.json'} as const;
export const WETH_CONVERSION_ABI=new Interface(['function deposit() payable','function withdraw(uint256 wad)','function balanceOf(address owner) view returns(uint256)','event Deposit(address indexed dst,uint256 wad)','event Withdrawal(address indexed src,uint256 wad)']);
export const WETH_CONVERSION_MAX_AMOUNT=10n**19n,WETH_CONVERSION_MAX_GAS_COST=10n**16n;
const address=z.string().max(42).refine(value=>{try{return getAddress(value)!=='0x0000000000000000000000000000000000000000';}catch{return false;}});
const digest=z.string().regex(/^0x[0-9a-f]{64}$/);
export const wethConversionSchema=z.object({version:z.literal(1),kind:z.literal('weth-conversion'),action:z.enum(['wrap','unwrap']),network:z.literal('ethereum'),chainId:z.literal(1),requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),from:address,recipient:address,amount:z.string().regex(/^[1-9][0-9]{0,19}$/),contract:z.literal(ETHEREUM_IDENTITIES.WETH.address),codeHash:z.literal(ETHEREUM_IDENTITIES.WETH.codeHash),unsignedTransaction:z.string().regex(/^0x[0-9a-f]+$/).max(2048),fingerprint:digest}).strict();
export type WethConversionRequest=z.infer<typeof wethConversionSchema>;
export const wethConversionResponseSchema=z.object({version:z.literal(1),kind:z.literal('weth-conversion-response'),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:digest,signedAt:z.string().datetime(),rawSignedTransaction:z.string().regex(/^0x[0-9a-f]+$/).max(4096),approvalSignature:z.string().regex(/^0x[0-9a-fA-F]{130}$/),transactionHash:digest}).strict();
export function wethConversionFingerprint(r:Omit<WethConversionRequest,'fingerprint'>|WethConversionRequest){return keccak256(new TextEncoder().encode(JSON.stringify(['DriveKey WETH conversion v1',Object.entries(r).filter(([k])=>k!=='fingerprint').sort(([a],[b])=>a.localeCompare(b,'en'))])));}
export function wethConversionApproval(r:WethConversionRequest){return `DriveKey WETH conversion approval v1\n${r.fingerprint}`;}
export function wethConversionCall(r:Pick<WethConversionRequest,'action'|'amount'>){return {to:ETHEREUM_IDENTITIES.WETH.address,value:r.action==='wrap'?BigInt(r.amount):0n,data:WETH_CONVERSION_ABI.encodeFunctionData(r.action==='wrap'?'deposit':'withdraw',r.action==='wrap'?[]:[r.amount])};}
export function validateWethConversion(input:unknown,now=Date.now(),checkExpiry=true){
 const r=wethConversionSchema.parse(input),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 if(!Number.isSafeInteger(now)||now<0||created>now+60000||expires<=created||expires-created>1800000||expires%1000!==0)throw Error('Invalid conversion lifetime or clock.');
 if(checkExpiry&&now>=expires)throw Error('WETH conversion approval expired.');
 if(getAddress(r.from)!==getAddress(r.recipient))throw Error('WETH conversion recipient must be the signing wallet itself.');
 if(BigInt(r.amount)>WETH_CONVERSION_MAX_AMOUNT)throw Error('Conversion amount exceeds 10 ETH/WETH.');
 if(wethConversionFingerprint(r)!==r.fingerprint)throw Error('Conversion fingerprint mismatch.');
 const tx=Transaction.from(r.unsignedTransaction),call=wethConversionCall(r);
 if(tx.signature||tx.type!==2||tx.chainId!==1n||tx.unsignedSerialized!==r.unsignedTransaction||tx.accessList?.length||tx.authorizationList?.length||tx.to!==call.to||tx.value!==call.value||tx.data!==call.data)throw Error('Transaction differs from exact self conversion.');
 if(tx.nonce>4294967295||tx.gasLimit<21000n||tx.gasLimit>100000n||!tx.maxFeePerGas||tx.maxFeePerGas<=0n||tx.maxPriorityFeePerGas===null||tx.maxPriorityFeePerGas>tx.maxFeePerGas||tx.gasLimit*tx.maxFeePerGas>WETH_CONVERSION_MAX_GAS_COST)throw Error('Conversion nonce or fee cap exceeded.');
 return r;
}
export function verifyWethConversionResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),checkExpiry=true){
 const r=validateWethConversion(request,now,checkExpiry),w=multiPublicSchema.parse(wallet),s=wethConversionResponseSchema.parse(input),tx=Transaction.from(s.rawSignedTransaction);
 if(r.deviceId!==w.deviceId||getAddress(r.from)!==getAddress(w.evmAddress)||s.requestId!==r.requestId||s.deviceId!==r.deviceId||s.fingerprint!==r.fingerprint||tx.unsignedSerialized!==r.unsignedTransaction||tx.from!==getAddress(r.from)||tx.hash!==s.transactionHash||getAddress(verifyMessage(wethConversionApproval(r),s.approvalSignature))!==getAddress(r.from))throw Error('Signed conversion differs from approved wallet or bytes.');
 const signed=Date.parse(s.signedAt);if(signed< Date.parse(r.createdAt)-60000||signed>=Date.parse(r.expiresAt)||signed>now+60000)throw Error('Invalid conversion signing time.');
 return s;
}
export function wethConversionReview(input:unknown,checkExpiry=true){
 const r=validateWethConversion(input,Date.now(),checkExpiry),tx=Transaction.from(r.unsignedTransaction);
 return {action:r.action==='wrap'?'Wrap ETH into WETH':'Unwrap WETH into ETH',network:'Ethereum mainnet / chain 1',from:r.from,recipient:r.recipient,contract:r.contract,contractCodeHash:r.codeHash,inputAsset:r.action==='wrap'?'ETH':'WETH',outputAsset:r.action==='wrap'?'WETH':'ETH',amount:formatUnits(r.amount,18),baseUnits:r.amount,outputBaseUnits:r.amount,gasLimit:tx.gasLimit.toString(),maximumFeePerGasWei:tx.maxFeePerGas!.toString(),maximumPriorityFeePerGasWei:tx.maxPriorityFeePerGas!.toString(),maximumFeeETH:formatUnits(tx.gasLimit*tx.maxFeePerGas!,18),nonce:String(tx.nonce),approvalExpiresUTC:r.expiresAt,fingerprint:r.fingerprint,warning:'Self conversion only. No swap, allowance or USDC delivery. Application expiry does not revoke signed bytes. Confirm conversion separately before preparing an allowance or a fresh swap.'};
}
