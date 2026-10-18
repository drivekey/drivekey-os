import {verifiedLocalArtifact} from '@/core/private-signer-artifact';
import {join} from 'node:path';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const artifacts={rc12:{filename:'drivekey-offline-amd64-v5-desktop-r21-rc12.iso',bytes:572915712,sha256:'2deff5e4cbe64615691b9c93628d6e25de9614df129e02b39bda9d4908fb1c74'},rc9:{filename:'drivekey-offline-amd64-v5-desktop-r21-rc9.iso',bytes:572915712,sha256:'f4b80a1af0de7fd503d7359700728e11c805d6a7731acb889c73808e14efa216'},rc10:{filename:'drivekey-offline-amd64-v5-desktop-r21-rc10.iso',bytes:572915712,sha256:'92ed8a4ec280738ce5fe9e8d6059eb3b8d0b8e5724d9ecd2c7fdddd6b9ea3bee'},rc11:{filename:'drivekey-offline-amd64-v5-desktop-r21-rc11.iso',bytes:572915712,sha256:'9414291991bbf298caac1e6f851eb6740947961810caa5740afbc0c3c671a4a7'}};
async function response(request:Request,head=false){
 if(process.env.VERCEL||!/^(?:127\.0\.0\.1|localhost):\d+$/.test(request.headers.get('host')||''))return Response.json({error:'Private loopback signer download only.'},{status:403});
 const version=new URL(request.url).searchParams.get('version')||'rc9';if(version!=='rc9'&&version!=='rc10'&&version!=='rc11'&&version!=='rc12')return Response.json({error:'Unsupported private signer version.'},{status:400});
 const {filename,bytes,sha256}=artifacts[version];
 const path=join(process.cwd(),'outputs','images',filename);
 let start=0,end=bytes-1;const range=request.headers.get('range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});start=Number(match[1]);end=match[2]?Number(match[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=bytes)return new Response(null,{status:416});}
 let artifact;try{artifact=await verifiedLocalArtifact(path,bytes,sha256);}catch{return Response.json({error:'Byte-checked private signer artifact is unavailable.'},{status:503});}if(head)await artifact.close();
 return new Response(head?null:artifact.stream(start,end),{status:range?206:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${filename}"`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-DriveKey-SHA256':sha256,'X-DriveKey-Verification':'local-byte-correspondence-only',...(range?{'Content-Range':`bytes ${start}-${end}/${bytes}`}:{})}});
}
export async function GET(request:Request){return response(request);}
export async function HEAD(request:Request){return response(request,true);}

