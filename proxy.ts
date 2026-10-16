import {NextResponse, type NextRequest} from 'next/server';

// Public file serving decodes paths after redirect matching. Match decoded paths
// too, so retained local legacy archives cannot bypass the release gate.
export function blockedLegacyDownload(pathname:string):boolean {
 let decoded=pathname;
 for(let i=0;i<5;i++){
  let next:string;
  try{next=decodeURIComponent(decoded);}catch{return true;}
  if(next===decoded)break;
  decoded=next;
  if(i===4)return true;
 }
 const normalized=new URL(decoded.replaceAll('\\','/').replace(/\/+/g,'/'),'https://drivekey.invalid').pathname.toLowerCase();
 if(!normalized.startsWith('/downloads/'))return false;
 return !['/downloads/windows-walkthrough.md','/downloads/release-manifest.json'].includes(normalized);
}

export function proxy(request:NextRequest){
 if(blockedLegacyDownload(request.nextUrl.pathname))return NextResponse.json({
  code:'OFFLINE_RELEASE_NOT_APPROVED',error:'Release verification is in progress. Downloads are unavailable.',fundingReady:false,productionReady:false,
 },{status:503,headers:{'Cache-Control':'no-store'}});
 return NextResponse.next();
}

// Do not restrict matching to the literal /downloads prefix: it can be encoded.
export const config={matcher:'/:path*'};
