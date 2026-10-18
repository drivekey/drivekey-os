import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import manifest from '../../../core/release-manifest.json';
import {blockedOfflineReleaseResponse, legacyResearchDownloadsEnabled} from '../../../core/offline-release-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const filename = manifest.image.filename;
if (!/^drivekey-offline-amd64-v(?:[234]|5-(?:experimental|desktop))(?:-r[0-9]+)?\.iso$/.test(filename)) throw new Error('Invalid release image filename.');
const publicUrl = new URL(manifest.image.url);
const blobRelease = publicUrl.hostname === 'vtsflbqh6nrltdiq.public.blob.vercel-storage.com' && publicUrl.pathname === `/releases/${filename}`;
const githubRelease = publicUrl.hostname === 'github.com' && publicUrl.pathname === `/pszymansky1-spec/drivekey-releases/releases/download/desktop-r20/${filename}`;
if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || !(blobRelease || githubRelease)) throw new Error('Invalid public release URL.');
function publicDownload() {
  // A historical URL/availability flag is not approval to distribute a release.
  return blockedOfflineReleaseResponse();
}
// Fixed public release artifact only; never a user-supplied path or mounted USB.
function imagePath() { return join(process.cwd(), 'outputs', 'images', filename); }
async function available() {
  if (process.env.VERCEL) return null; // Never trace/upload a large local ISO into a serverless function.
  try { const info = await stat(imagePath()); return info.isFile() && info.size === manifest.image.bytes && info.size > 0 ? info : null; }
  catch { return null; }
}
export async function HEAD() {
  if (!legacyResearchDownloadsEnabled()) return blockedOfflineReleaseResponse();
  const info = await available();
  if (!info) return publicDownload();
  return new Response(null, {status:200, headers:{'Content-Length':String(info.size),'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-DriveKey-Release-Class':'legacy-unfunded-research'}});
}
export async function GET(request: Request) {
  if (!legacyResearchDownloadsEnabled()) return blockedOfflineReleaseResponse();
  const info = await available();
  if (!info) return publicDownload();
  let start = 0, end = info.size - 1;
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});
    start=Number(match[1]); end=match[2]?Number(match[2]):end;
    if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=info.size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});
  }
  const stream = Readable.toWeb(createReadStream(imagePath(), {start,end}));
  return new Response(stream as ReadableStream, {status:range?206:200, headers:{
    'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${filename}"`,
    'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-DriveKey-Release-Class':'legacy-unfunded-research',
    ...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})
  }});
}
