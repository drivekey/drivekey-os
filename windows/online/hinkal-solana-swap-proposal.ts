const {prepare:preparePinnedGoonQuote,tokenAmount:parsePinnedGoonAccount}=require('./hinkal-solana-direct-quote.cjs');
export {parsePinnedGoonAccount};
import {verifySolanaPrograms} from './solana-programs';
import {VersionedTransaction} from '@solana/web3.js';
import {OnlineAdapter} from './adapter';
import {LifiQuotes} from './providers';
import {LifiSolanaAdapter} from './lifi-solana';
import {inspectLifiSolana,resolveLifiSolana,SOLANA_LIFI} from '../engine/core/lifi-solana-inspect';
const {BorshInstructionCoder}=require('@coral-xyz/anchor/dist/cjs/coder/borsh/instruction.js'),coder=new BorshInstructionCoder(require('../vendor/jupiter/idl.json'));
// Only these CPI venues have passed the full native private-swap VM lifecycle.
// Public wallet swaps have a separate, broader decoder allowlist.
import {assertHinkalSolanaRouteQualified} from '../engine/core/hinkal-solana-route-admission';
export {assertHinkalSolanaRouteQualified};
// Unfunded public proposal only. This never simulates with invented balances,
// authorizes a proof, signs, or broadcasts. Final private execution is separate.
export async function prepareHinkalSolanaSwapProposal(adapter:OnlineAdapter,from:string,amount:string,quotes=new LifiQuotes()){try{
 await adapter.identity('solana');const q=await quotes.quote({fromChain:'solana',toChain:'solana',fromAsset:'SOL',toAsset:'USDC',amount,fromAddress:from,toAddress:from,slippageBps:100,exchange:'jupiter'}),created=Date.now(),serialized=q.quote.transactionRequest?.data;if(typeof serialized!=='string')throw Error('Missing native private swap proposal.');const tx=VersionedTransaction.deserialize(Buffer.from(serialized,'base64')),lookupTables=await new LifiSolanaAdapter(adapter).lookupTables(tx),resolved=resolveLifiSolana(serialized,lookupTables),ix=resolved.message.instructions.find(i=>i.programId.toBase58()===SOLANA_LIFI.jupiter),decoded=ix?coder.decode(ix.data):null;if(!decoded||!['route_v2','shared_accounts_route_v2'].includes(decoded.name))throw Error('Unknown private Solana swap proposal variant: '+(decoded?.name||'missing'));const d=decoded.data,limit=resolved.message.instructions[0].data.readUInt32LE(1),price=resolved.message.instructions[1].data.readBigUInt64LE(1),epoch=(await adapter.rpc('solana','getEpochInfo',[{commitment:'confirmed'}])).epoch,bounds={from,recipient:from,tokenIn:'SOL' as const,amount,quotedOutput:d.quoted_out_amount.toString(10),minimumOutput:(BigInt(d.quoted_out_amount.toString(10))*BigInt(10000-d.slippage_bps)/10000n).toString(),slippageBps:100,maximumFee:(5000n+(BigInt(limit)*price+999999n)/1000000n).toString(),protocolFee:(BigInt(amount)*25n/10000n).toString(),epoch},proposal={bounds,unsignedTransaction:serialized,lookupTables};if(q.quote.estimate.toAmount!==bounds.quotedOutput)throw Error('Private swap quote differs from encoded output.');assertHinkalSolanaRouteQualified(inspectLifiSolana(serialized,lookupTables,bounds).review);await verifySolanaPrograms(adapter,resolved.keys.map(k=>k.toBase58()));return {proposal,resolved,created,expires:created+180000};}catch(error){if(error instanceof Error&&adapter.endpoints.solana?.startsWith('https:')&&/Private PDA execution is not qualified|Unknown AMM variant|Unreviewed intermediate mint|Unknown private Solana swap proposal variant/.test(error.message))return preparePinnedGoonQuote(from,amount,adapter);throw error;}
}
