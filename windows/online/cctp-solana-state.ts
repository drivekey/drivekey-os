import {OnlineAdapter} from './adapter';
import {verifySolanaPrograms} from './solana-programs';
import {parseCctpSolanaState,cctpSolanaStateAddress} from '../engine/core/cctp-solana-state';
const pins=require('../vendor/mayan/solana-provenance.json').programs;
export async function readCctpSolanaState(a:OnlineAdapter){await a.identity('solana');await verifySolanaPrograms(a,pins.map((p:any)=>p.address),pins);const state=await a.rpc('solana','getAccountInfo',[cctpSolanaStateAddress(),{encoding:'base64',commitment:'finalized'}]);if(!Number.isSafeInteger(state.context?.slot)||state.context.slot<1)throw Error('Missing finalized Circle Solana state context.');return {...parseCctpSolanaState(state.value),contextSlot:state.context.slot,observedAt:new Date().toISOString(),programPins:pins.map((p:any)=>({address:p.address,programDataSha256:p.programDataSha256}))};}
