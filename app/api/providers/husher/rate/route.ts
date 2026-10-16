import {NextRequest,NextResponse} from 'next/server';
import {husherRateInput,inspectHusherPrivateRate} from '@/core/husher-api';
export const runtime='nodejs';
// Loopback diagnostic only. Credentials and order operations cannot be supplied by this route.
export async function POST(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 const host=req.headers.get('host')||'';
 if(process.env.VERCEL||!/^127\.0\.0\.1:\d+$/.test(host)||req.headers.get('origin')!==`http://${host}`)return reply({error:'Private loopback rate check only.'},403);
 if(req.headers.get('content-type')!=='application/json')return reply({error:'Expected JSON.'},415);
 let input:unknown;
 try{
  const reader=req.body?.getReader();if(!reader)throw Error();
  let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256){await reader.cancel();return reply({error:'Request too large.'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  input=husherRateInput.parse(JSON.parse(text));
 }catch{return reply({error:'Expected a supported route and decimal amount only.'},400);}
 try{return reply(await inspectHusherPrivateRate(input,process.env.HUSHER_API_KEY));}
 catch(e){return reply({error:e instanceof Error?e.message:'Rate inspection failed.',ordersEnabled:false,privacyEnabled:false,signingEnabled:false},503);}
}
