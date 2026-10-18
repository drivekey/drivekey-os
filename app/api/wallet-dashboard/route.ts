import {withServiceTelemetry} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import { NextRequest, NextResponse } from 'next/server';
import { sameRequestOrigin } from '@/core/http-origin';
import { readDashboardBalances, type PublicRpc } from '@/core/dashboard-public';
import {publicRpcUrl} from '@/core/public-provider';
import {boundedRpcCall} from '@/core/rpc-proxy';
export const runtime='nodejs';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const allowed=new Set(['eth_chainId','eth_getBalance','eth_call','getGenesisHash','getBalance','getTokenAccountsByOwner']);
const rpc:PublicRpc=async(network,method,params)=>{
  if(!allowed.has(method))throw Error('Read-only method required');
  const url=publicRpcUrl(network);
  return boundedRpcCall(url,method,params);
};
const calls=new Map<string,{count:number;until:number}>();
async function handlePost(request:NextRequest){
  if(!sameRequestOrigin(request.headers.get('origin'),request.headers.get('host'),request.nextUrl.protocol))return reply({error:'Cross-origin request refused.'},403);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected a public wallet JSON.'},415);
  const now=Date.now();for(const[k,v]of calls)if(v.until<now)calls.delete(k);
  if(calls.size>10000)return reply({error:'Service busy.'},429);
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0]||'local';const limit=calls.get(ip)||{count:0,until:now+60000};calls.set(ip,limit);
  if(++limit.count>12)return reply({error:'Please wait before refreshing again.'},429);
  try{
    const reader=request.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder();
    for(;;){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
    const input=JSON.parse(text);
 const sharedLimit=await serviceRateLimitHttp('wallet-dashboard',reply);if(sharedLimit)return sharedLimit;
    return reply({balances:await readDashboardBalances(input,rpc)});
  }catch{return reply({error:'Invalid public wallet file. Import wallet-public.json or wallet-multi-public.json.'},400);}
}

export const POST=withServiceTelemetry('wallet-dashboard',handlePost);
