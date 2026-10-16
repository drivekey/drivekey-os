import {NextRequest,NextResponse} from 'next/server';
import {sameRequestOrigin} from '@/core/http-origin';
import {parseStrictPublicJson} from '@/core/strict-public-json';
import {savingsRehearsalAction,savingsRehearsalEndpoint} from '@/companion/savings-rehearsal';
export const runtime='nodejs';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return reply(await savingsRehearsalAction({action:'status'}));}catch{return reply({available:false,fundingReady:false},503);}}
export async function POST(req:NextRequest){
 try{savingsRehearsalEndpoint();}catch{return reply({error:'Local Savings rehearsal is unavailable.',fundingReady:false},503);}
 if(!sameRequestOrigin(req.headers.get('origin'),req.headers.get('host'),req.nextUrl.protocol)||!['127.0.0.1','localhost'].includes(req.nextUrl.hostname))return reply({error:'Local same-origin request required.'},403);
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'Expected JSON.'},415);
 try{const reader=req.body?.getReader();if(!reader)throw Error('Missing body.');let size=0;const chunks:Uint8Array[]=[];
  for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>65536){await reader.cancel();throw Error('Public request exceeds limit.');}chunks.push(v.value);}
  const bytes=Buffer.concat(chunks);return reply(await savingsRehearsalAction(parseStrictPublicJson(new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes),65536)));
 }catch(error){return reply({error:error instanceof Error?error.message:'Local rehearsal failed.',fundingReady:false},400);}
}
