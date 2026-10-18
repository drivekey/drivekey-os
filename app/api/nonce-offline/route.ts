import {withServiceTelemetry,tagServiceResponse,operationalReason} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {serverSolanaConnection} from '@/core/solana-rpc';
import {WalletSubmissionLedger} from '@/core/wallet-submission-ledger';
import {NextRequest,NextResponse} from 'next/server';

import {ZodError} from 'zod';
import {sameRequestOrigin} from '@/core/http-origin';
import {offlineNonceAction} from '@/core/offline-nonce-service';
import {PAYMENT_PATHS,LIVE_RELEASE_BLOCK} from '@/core/live-release-policy';
export const runtime='nodejs';
const enabled=()=>PAYMENT_PATHS['solana-offline-nonce'].enabled;
export async function GET(){return NextResponse.json({enabled:enabled(),requiredSigner:'r21-rc9',signing:'offline only'},{headers:{'Cache-Control':'no-store'}});}
const limits=new Map<string,{count:number;until:number}>();
async function handlePost(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol))return reply({error:'Cross-origin nonce action refused.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 const now=Date.now();for(const [key,value] of limits)if(value.until<now)limits.delete(key);if(limits.size>10000)return reply({error:'Service busy.'},429);
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local',limit=limits.get(ip)||{count:0,until:now+60000};limits.set(ip,limit);if(++limit.count>30)return reply({error:'Rate limited.'},429);
 try{
  const reader=req.body?.getReader();if(!reader)throw Error('Missing body.');let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw Error('Public nonce file too large.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  const input=JSON.parse(text);
  if(input?.action==='submit'&&!enabled())return reply(LIVE_RELEASE_BLOCK,503);
 const sharedLimit=await serviceRateLimitHttp('nonce-offline',reply);if(sharedLimit)return sharedLimit;
  let store:WalletSubmissionLedger|undefined;
  if(input?.action==='submit'){const url=process.env.WALLET_SUBMISSION_DATABASE_URL,scope=process.env.WALLET_SUBMISSION_SCOPE;if(!url||!scope)throw Error('Durable wallet submission storage is not configured.');store=new WalletSubmissionLedger(url,scope);}
  const connection=serverSolanaConnection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
  return reply(await offlineNonceAction(input,connection,enabled(),store));
 }catch(e){return tagServiceResponse(reply({error:e instanceof ZodError?'Malformed public nonce action.':e instanceof Error?e.message:'Nonce action stopped.'},400),operationalReason(e));}
}

export const POST=withServiceTelemetry('nonce-offline',handlePost);
