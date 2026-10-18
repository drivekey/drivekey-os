import {withServiceTelemetry} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {NextRequest,NextResponse} from 'next/server';
import {sameRequestOrigin} from '@/core/http-origin';
import {getLifiQuote,lifiQuoteInput} from '@/core/lifi-quote';
export const runtime='nodejs';
export const maxDuration=30;
const limits=new Map<string,{count:number;until:number}>();let active=0;
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handlePost(req:NextRequest){
 if(!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol))return reply({error:'Same-origin quote request required.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 const now=Date.now();for(const [key,v] of limits)if(v.until<now)limits.delete(key);
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local';
 if(limits.size>=10000&&!limits.has(ip))return reply({error:'Quote service is busy.'},429);
 const limit=limits.get(ip)||{count:0,until:now+60000};limits.set(ip,limit);
 if(++limit.count>10||active>=4)return reply({error:'Too many quote requests. Try again in a minute.'},429);
 let input:unknown;
 try{const reader=req.body?.getReader();if(!reader)throw Error();let size=0,text='';const decoder=new TextDecoder();for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply({error:'Request too large.'},413);}text+=decoder.decode(value,{stream:true});}input=lifiQuoteInput.parse(JSON.parse(text+decoder.decode()));}catch{return reply({error:'Choose supported assets, a positive amount and a multichain public wallet.'},400);}
 const sharedLimit=await serviceRateLimitHttp('lifi-quote',reply);if(sharedLimit)return sharedLimit;
 if(active>=4)return reply({error:'Too many quote requests. Try again shortly.'},429);
 active++;try{return reply(await getLifiQuote(input));}catch(e){return reply({error:e instanceof Error?e.message:'Quote unavailable.',signingEnabled:false},503);}finally{active--;}
}


export const POST=withServiceTelemetry('lifi-quote',handlePost);
