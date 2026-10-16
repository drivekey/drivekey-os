import {withServiceTelemetry} from '@/core/server-service-telemetry';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
import {NextRequest,NextResponse} from 'next/server';
import {approvedAppOrigin} from '@/core/app-origin';
import {husherStandardQuoteInput,inspectHusherStandardQuote} from '@/core/husher-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Public, read-only pricing. Owner sessions, order APIs and signing stay separate.
// Per-instance load shedding, not a distributed abuse-prevention guarantee.
let inFlight=0;
const limits=new Map<string,{count:number;until:number}>();
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handlePost(req:NextRequest){
 const host=req.headers.get('host')||'',origin=req.headers.get('origin');
 const expected=approvedAppOrigin('https://'+host)?'https://'+host:process.env.VERCEL_URL===host?'https://'+host:!process.env.VERCEL&&/^127\.0\.0\.1:\d+$/.test(host)?'http://'+host:'';
 if(!expected||origin!==expected)return reply({error:'Same-origin quote request required.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 const now=Date.now();for(const [key,value] of limits)if(value.until<now)limits.delete(key);
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'local';
 if(limits.size>=10000&&!limits.has(ip))return reply({error:'Quote service is busy.'},429);
 const limit=limits.get(ip)||{count:0,until:now+60000};limits.set(ip,limit);
 if(++limit.count>30)return reply({error:'Too many quote requests. Try again in a minute.'},429);
 let input:unknown;
 try{
  const reader=req.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256){await reader.cancel();return reply({error:'Request too large.'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  input=husherStandardQuoteInput.parse(JSON.parse(text));
 }catch{return reply({error:'Enter only a positive USDC receive amount up to 1,000, with at most six decimal places.'},400);}
 const sharedLimit=await serviceRateLimitHttp('husher-quote',reply);if(sharedLimit)return sharedLimit;
 if(inFlight>=4)return reply({error:'Quote service is busy. Try again shortly.'},429);
 inFlight++;
 try{return reply(await inspectHusherStandardQuote(input,process.env.HUSHER_API_KEY));}
 catch(e){return reply({error:e instanceof Error?e.message:'Quote unavailable.',ordersEnabled:false,signingEnabled:false,privacyEnabled:false},503);}
 finally{inFlight--;}
}

export const POST=withServiceTelemetry('husher-quote',handlePost);
