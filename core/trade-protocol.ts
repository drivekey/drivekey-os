import { z } from 'zod';
import { Interface, Transaction, getAddress, keccak256, verifyMessage, formatUnits } from 'ethers';
import { multiPublicSchema } from './multi-protocol';
import {ethereumIdentitySchema,validateEthereumIdentities} from './ethereum-contract-identity';

// v4 is separate from the deliberately narrow v2/v3 transfer formats.
export const ETH_TOKENS = { WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 }, USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 } } as const;
export const SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
export const QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
export const ROUTER = new Interface(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)']);
export const TOKEN = new Interface(['function approve(address spender,uint256 amount) returns(bool)','function transfer(address to,uint256 amount) returns(bool)','function allowance(address owner,address spender) view returns(uint256)','function balanceOf(address owner) view returns(uint256)','event Transfer(address indexed from,address indexed to,uint256 value)']);
const address = z.string().refine(v=>{try{return getAddress(v)!=='0x0000000000000000000000000000000000000000';}catch{return false;}});
const quantity = z.string().regex(/^(0|[1-9][0-9]*)$/).max(78).refine(v=>BigInt(v)<2n**256n);
const digest = z.string().regex(/^0x[0-9a-f]{64}$/);
export const legacyTradeSchema = z.object({version:z.literal(4),network:z.literal('ethereum'),chainId:z.literal(1),kind:z.enum(['swap','approval','payment']),requestId:z.string().uuid(),deviceId:z.string().uuid(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),from:address,recipient:address,tokenIn:z.enum(['ETH','WETH','USDC']),tokenOut:z.enum(['WETH','USDC']).nullable(),amount:quantity,minimumOutput:quantity,quotedOutput:quantity,slippageBps:z.number().int().min(0).max(100),poolFee:z.union([z.literal(500),z.literal(3000)]),unsignedTransaction:z.string().regex(/^0x[0-9a-f]+$/).max(4096),fingerprint:digest}).strict();
export const boundTradeSchema=legacyTradeSchema.extend({version:z.literal(7),contractIdentities:z.array(ethereumIdentitySchema).max(7)}).strict();
export const tradeSchema=z.discriminatedUnion('version',[legacyTradeSchema,boundTradeSchema]);
export type TradeRequest = z.infer<typeof tradeSchema>;
export const tradeResponseSchema = z.object({version:z.union([z.literal(4),z.literal(7)]),requestId:z.string().uuid(),deviceId:z.string().uuid(),fingerprint:digest,signedAt:z.string().datetime(),rawSignedTransaction:z.string().max(8192),approvalSignature:z.string().max(132),transactionHash:digest}).strict();
export type TradeResponse = z.infer<typeof tradeResponseSchema>;
export function tradeFingerprint(r:Omit<TradeRequest,'fingerprint'>|TradeRequest) { return keccak256(new TextEncoder().encode(JSON.stringify([`DriveKey transaction v${r.version}`,Object.entries(r).filter(([k])=>k!=='fingerprint').sort(([a],[b])=>a.localeCompare(b,'en'))]))); }
export function tradeApproval(r:TradeRequest) {return `DriveKey transaction approval v${r.version}\n${r.fingerprint}`;}
export function tradeCall(r:TradeRequest) {
 if(r.kind==='swap') {
  if(r.tokenIn==='ETH'||!r.tokenOut||r.tokenIn===r.tokenOut||getAddress(r.recipient)!==getAddress(r.from)||BigInt(r.minimumOutput)<=0n||BigInt(r.quotedOutput)<=0n||BigInt(r.minimumOutput)!==BigInt(r.quotedOutput)*BigInt(10000-r.slippageBps)/10000n)throw Error('Invalid swap constraints.');
  return {to:SWAP_ROUTER,value:0n,data:ROUTER.encodeFunctionData('exactInputSingle',[[ETH_TOKENS[r.tokenIn].address,ETH_TOKENS[r.tokenOut].address,r.poolFee,r.from,Math.floor(Date.parse(r.expiresAt)/1000),r.amount,r.minimumOutput,0]])};
 }
 if(r.tokenOut!==null||r.minimumOutput!=='0'||r.quotedOutput!=='0'||r.slippageBps!==0||r.poolFee!==500)throw Error('Unexpected non-swap context.');
 if(r.kind==='approval') {
  if(r.tokenIn==='ETH'||getAddress(r.recipient)!==SWAP_ROUTER)throw Error('Only the pinned swap router can receive an approval.');
  return {to:ETH_TOKENS[r.tokenIn].address,value:0n,data:TOKEN.encodeFunctionData('approve',[SWAP_ROUTER,r.amount])};
 }
 if(getAddress(r.recipient)===getAddress(r.from))throw Error('Self payments are unsupported.');
 return r.tokenIn==='ETH'?{to:r.recipient,value:BigInt(r.amount),data:'0x'}:{to:ETH_TOKENS[r.tokenIn].address,value:0n,data:TOKEN.encodeFunctionData('transfer',[r.recipient,r.amount])};
}
export function validateTrade(input:unknown,now=Date.now(),checkExpiry=true):TradeRequest {
 const r=tradeSchema.parse(input),created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 if(expires<=created||expires-created>30*60_000||created>now+60_000||expires%1000!==0)throw Error('Invalid request lifetime or clock.');
 if(checkExpiry&&now>=expires)throw Error('Request expired. Prepare a fresh request.');
 if(r.version===7)validateEthereumIdentities(r,r.contractIdentities);
 if(tradeFingerprint(r)!==r.fingerprint)throw Error('Request fingerprint mismatch.');
 if(BigInt(r.amount)<=0n||BigInt(r.amount)>=2n**128n)throw Error('Invalid amount; unlimited approvals are forbidden.');
 const tx=Transaction.from(r.unsignedTransaction),call=tradeCall(r);
 if(tx.signature||tx.type!==2||tx.chainId!==1n||tx.unsignedSerialized!==r.unsignedTransaction||tx.accessList?.length||tx.authorizationList?.length||!tx.to||getAddress(tx.to)!==getAddress(call.to)||tx.value!==call.value||tx.data!==call.data)throw Error('Transaction bytes do not match the exact reviewed action.');
 if(tx.nonce>4294967295||tx.gasLimit<21000n||tx.gasLimit>1000000n||!tx.maxFeePerGas||tx.maxFeePerGas<=0n||tx.maxPriorityFeePerGas===null||tx.maxPriorityFeePerGas>tx.maxFeePerGas||tx.gasLimit*tx.maxFeePerGas>100000000000000000n)throw Error('Fee or nonce policy exceeded.');
 return r;
}
export function verifyTradeResponse(input:unknown,request:unknown,wallet:unknown,now=Date.now(),checkExpiry=true) {
 const r=validateTrade(request,now,checkExpiry),w=multiPublicSchema.parse(wallet),s=tradeResponseSchema.parse(input),tx=Transaction.from(s.rawSignedTransaction);
 if(s.version!==r.version||r.deviceId!==w.deviceId||getAddress(r.from)!==getAddress(w.evmAddress)||s.deviceId!==r.deviceId||s.requestId!==r.requestId||s.fingerprint!==r.fingerprint||tx.unsignedSerialized!==r.unsignedTransaction||tx.from!==getAddress(w.evmAddress)||tx.hash!==s.transactionHash||getAddress(verifyMessage(tradeApproval(r),s.approvalSignature))!==getAddress(w.evmAddress))throw Error('Signed response does not match the approved request.');
 if(Date.parse(s.signedAt)<Date.parse(r.createdAt)-60000||Date.parse(s.signedAt)>=Date.parse(r.expiresAt)||Date.parse(s.signedAt)>now+60000)throw Error('Invalid signing time.');
 return s;
}
export function tradeReview(input:unknown,checkExpiry=true) {
 const r=validateTrade(input,Date.now(),checkExpiry),tx=Transaction.from(r.unsignedTransaction);
 return {...(r.version===7?{requiredSigner:'RC12 or later (version 7 Ethereum approval)',contractIdentities:r.contractIdentities.map(p=>[p.name,p.address,'Code hash: '+p.codeHash,...(p.implementation?['Implementation slot: '+p.implementationSlot,'Implementation: '+p.implementation,'Implementation code hash: '+p.implementationCodeHash]:[])].join('\n')).join('\n\n')||'Native ETH; no token or router contract',identityWarning:'Contract identities are checked online before submission. USDC may be upgraded after signing; approval does not freeze its implementation.'}:{}),action:r.kind,network:'Ethereum mainnet / chain 1',from:r.from,recipient:r.recipient,asset:r.tokenIn,tokenContract:r.tokenIn==='ETH'?'Native ETH':ETH_TOKENS[r.tokenIn].address,amount:formatUnits(r.amount,r.tokenIn==='USDC'?6:18)+' '+r.tokenIn,baseUnits:r.amount,...(r.kind==='swap'?{outputAsset:r.tokenOut!,outputContract:ETH_TOKENS[r.tokenOut!].address,minimumReceived:formatUnits(r.minimumOutput,ETH_TOKENS[r.tokenOut!].decimals)+' '+r.tokenOut,slippage:r.slippageBps/100+'%',route:'Uniswap v3 / single pool / '+r.poolFee,router:SWAP_ROUTER}:{}),maximumFee:formatUnits(tx.gasLimit*tx.maxFeePerGas!,18)+' ETH',nonce:String(tx.nonce),deadlineUTC:r.expiresAt,fingerprint:r.fingerprint,warning:r.kind==='swap'?'Minimum output and deadline are enforced by swap calldata. Quote is an online estimate.':'Application expiry does not revoke a signed payment or token approval. Approval grants spending authority to the displayed router.'};
}
