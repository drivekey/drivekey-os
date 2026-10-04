// Retain the v3 offline transfer format while sharing the candidate's submission journal.
import type {Connection} from '@solana/web3.js';
import {verifyMultiResponse} from './multi-protocol';
import {multiAction,multiStatus} from './multi-service';
import {validateSolPayment} from './sol-payment-protocol';
export async function solPaymentStatus(input:{request?:unknown;response?:unknown;wallet?:unknown},connection:Connection){
 validateSolPayment(input.request,Date.now(),false);
 const s=verifyMultiResponse(input.response,input.request,input.wallet,Date.now(),false);
 const status=await multiStatus(validateSolPayment(input.request,Date.now(),false),s.transactionHash,async()=>{throw Error('Unexpected Ethereum RPC.');},connection,s.rawSignedTransaction);
 return {...status,state:status.state==='not-seen'?'unknown':status.state==='pending'?'submitted':status.state};
}
export async function preflightSolPayment(input:{request?:unknown;response?:unknown;wallet?:unknown},connection:Connection){
 validateSolPayment(input.request);
 const result=await multiAction({action:'preflight',request:input.request,response:input.response,wallet:input.wallet},async()=>{throw Error('Unexpected Ethereum RPC for Solana payment.');},connection,false);
 validateSolPayment(input.request); // Simulation can cross the application deadline.
 return result;
}
