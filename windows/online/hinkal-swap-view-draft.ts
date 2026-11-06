// Public quote construction only. No viewing capability or wallet key enters
// here; every executable route is independently decoded before it is returned.
import {z} from 'zod';
import {getAddress} from 'ethers';
import {canonical} from '../engine/core/payment-intent';
import {multiPublicSchema} from '../engine/core/multi-protocol';
import {privateSwapDraftParameters} from '../engine/core/hinkal-view';
import {HINKAL_NATIVE_SWAP,validateHinkalEvmSwapContext} from '../engine/core/hinkal-evm-swap-proof';
import {validateHinkalSolanaSwapContext} from '../engine/core/hinkal-local-solana-swap';
import {hinkalSolanaSwapRoute} from '../engine/core/hinkal-solana-swap-route';
import {assertHinkalSolanaRouteQualified} from '../engine/core/hinkal-solana-route-admission';
import {LIFI_ROUTER,LIFI_EVM} from '../engine/core/lifi-evm-intent';
import {HINKAL_SOLANA} from '../engine/core/hinkal-solana-intent';
import {OnlineAdapter} from './adapter';
import {LifiQuotes} from './providers';
import {HinkalEvmSwapAdapter} from './hinkal-evm-swap';
import {verifySolanaPrograms} from './solana-programs';
import {prepareHinkalSolanaSwapProposal} from './hinkal-solana-swap-proposal';
import {privateInputReaders} from './hinkal-owned-inputs';
type Dependencies={adapters?:OnlineAdapter[],quotes?:Pick<LifiQuotes,'quote'>,verifyIdentity?:(a:OnlineAdapter,chain:'ethereum'|'solana')=>Promise<void>,solanaProposal?:(a:OnlineAdapter,from:string,amount:string)=>Promise<any>};
async function verifyIdentity(a:OnlineAdapter,chain:'ethereum'|'solana'){if(chain==='ethereum')await new HinkalEvmSwapAdapter(a).identity();else{await a.identity('solana');if(!(await verifySolanaPrograms(a,[HINKAL_SOLANA.program],[HINKAL_SOLANA.pin])).includes(HINKAL_SOLANA.program))throw Error('Pinned private swap deployment is unavailable.');}}
export async function preparePrivateSwapViewDraft(input:unknown,wallet:unknown,now=Date.now(),deps:Dependencies={}){
 const raw=z.object({parameters:z.unknown(),inputNotes:z.array(z.string().regex(/^0x[0-9a-f]+$/).max(4096)).min(1).max(2)}).strict().parse(input),p=privateSwapDraftParameters(raw.parameters),w=multiPublicSchema.parse(wallet),adapters=deps.adapters??privateInputReaders(p.chain),from=p.chain==='ethereum'?getAddress(w.evmAddress):w.solanaAddress,started=performance.now(),clock=()=>now+Math.floor(performance.now()-started);
 if(!Number.isSafeInteger(now)||new Set(raw.inputNotes).size!==raw.inputNotes.length||adapters.length!==2)throw Error('Choose distinct original swap inputs and independent readers.');const origins=adapters.map(a=>{const u=new URL(a.endpoints[p.chain]!);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Independent HTTPS private swap identity readers are required.');return u.origin;});if(new Set(origins).size!==2)throw Error('Independent HTTPS private swap identity readers are required.');for(const a of adapters)await(deps.verifyIdentity??verifyIdentity)(a,p.chain);
 let context:any;if(p.chain==='ethereum'){
  const quoteCreatedAt=new Date(clock()).toISOString(),result=await(deps.quotes??new LifiQuotes()).quote({fromChain:'ethereum',toChain:'ethereum',fromAsset:'ETH',toAsset:'USDC',amount:p.amount,fromAddress:HINKAL_NATIVE_SWAP.external.address,toAddress:HINKAL_NATIVE_SWAP.external.address,slippageBps:p.slippageBps,exchange:'1inch'}),q=result.quote,tx=q.transactionRequest,fees=q.estimate?.feeCosts;
  if(!tx||Number(tx.chainId)!==1||getAddress(tx.to!)!==LIFI_EVM.diamond.address||BigInt(tx.value!)!==BigInt(p.amount)||tx.from&&getAddress(tx.from)!==HINKAL_NATIVE_SWAP.external.address||typeof tx.data!=='string'||tx.data.length>24000||!Array.isArray(fees)||fees.length!==1)throw Error('Public private-swap quote transaction, chain or fee metadata differs.');const route=LIFI_ROUTER.parseTransaction({data:tx.data});if(!route)throw Error('Public private-swap quote has no decoded route.');context={testOnly:true,chain:'ethereum',action:'swap',from,recipient:from,tokenIn:'ETH',tokenOut:'USDC',amount:p.amount,quotedOutput:q.estimate.toAmount,minimumOutput:q.estimate.toAmountMin,slippageBps:p.slippageBps,protocolFee:fees[0].amount,transactionId:route.args.transactionId,routeData:tx.data,quoteCreatedAt,quoteExpiresAt:new Date(Date.parse(quoteCreatedAt)+180000).toISOString(),inputNotes:raw.inputNotes,pendingLeaves:[]};context=validateHinkalEvmSwapContext(context);
 }else{
  const proposal=await(deps.solanaProposal??prepareHinkalSolanaSwapProposal)(adapters[0],from,p.amount);if(!Number.isSafeInteger(proposal.created)||!Number.isSafeInteger(proposal.expires)||proposal.expires>proposal.created+180000||proposal.expires<=proposal.created||proposal.created>clock()+60000||BigInt(proposal.proposal.bounds.maximumFee)>BigInt(p.maximumFee))throw Error('Public private-swap proposal lifetime or fee differs.');context=validateHinkalSolanaSwapContext({testOnly:true,chain:'solana',action:'swap',asset:'SOL',from,recipient:from,amount:p.amount,inputNotes:raw.inputNotes,pendingLeaves:[],quoteCreatedAt:new Date(proposal.created).toISOString(),quoteExpiresAt:new Date(proposal.expires).toISOString(),proposal:proposal.proposal});assertHinkalSolanaRouteQualified(hinkalSolanaSwapRoute(context.proposal,'1').review);
 }
 if(clock()>=Date.parse(context.quoteExpiresAt)||canonical(context.inputNotes)!==canonical(raw.inputNotes))throw Error('Private swap quote expired or changed selected inputs.');const result={profile:p.chain==='ethereum'?19:27,context,eligibleForSigning:false,blockchainTransactionSigned:false,submitted:false};if(Buffer.byteLength(JSON.stringify(result))>64*1024)throw Error('Private swap draft exceeds the bounded public response.');return result;
}
