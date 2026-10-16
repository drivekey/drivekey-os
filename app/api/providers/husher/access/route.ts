import {NextRequest,NextResponse} from 'next/server';
import {inspectHusherAccess} from '@/core/husher-api';
export const runtime='nodejs';
// Private preview diagnostic only. This endpoint cannot create orders or accept credentials.
export async function POST(req:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 const host=req.headers.get('host')||'',origin=req.headers.get('origin');
 if(process.env.VERCEL||!/^127\.0\.0\.1:\d+$/.test(host)||origin!==`http://${host}`)return reply({error:'Private loopback access check only.'},403);
 if(req.headers.get('content-type')!=='application/json')return reply({error:'Expected JSON.'},415);
 // A fixed small body prevents accidentally accepting or logging an API key supplied by a browser.
 const reader=req.body?.getReader();if(!reader)return reply({error:'Expected inspect-access action.'},400);
 let body='',size=0;const decoder=new TextDecoder();
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>64){await reader.cancel();return reply({error:'Request too large.'},413);}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();
 if(body!=='{"action":"inspect-access"}')return reply({error:'Expected inspect-access action.'},400);
 try{return reply(await inspectHusherAccess(process.env.HUSHER_API_KEY));}
 catch(e){return reply({error:e instanceof Error?e.message:'Access check failed.',ordersEnabled:false,privacyEnabled:false},503);}
}
