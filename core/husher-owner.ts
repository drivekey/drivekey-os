import 'server-only';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {HusherLedger} from './husher-ledger';
import {approvedAppOrigin} from './app-origin';
export const husherOwnerCookie='__Host-drivekey-husher-owner';
export const ownerTokenDigest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validOwnerOrigin(origin:string|null,expected:string){return origin===expected&&(approvedAppOrigin(expected)||/^https:\/\/drivekey-robinhood-[a-z0-9]+-pawel-s-projects21\.vercel\.app$/.test(expected)||/^http:\/\/127\.0\.0\.1:\d+$/.test(expected));}
export async function authenticateHusherOwner(code:unknown,expectedHash:string|undefined,store:Pick<HusherLedger,'createSession'>){
 if(typeof code!=='string'||!/^[-_a-zA-Z0-9]{43}$/.test(code)||!expectedHash||!/^[0-9a-f]{64}$/.test(expectedHash)||!timingSafeEqual(Buffer.from(ownerTokenDigest(code),'hex'),Buffer.from(expectedHash,'hex')))throw Error('Owner authentication failed.');
 const token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+30*60_000);await store.createSession(ownerTokenDigest(token),expires);return {token,expires};
}
export async function requireHusherOwner(token:string|undefined,store:Pick<HusherLedger,'hasSession'>){
 if(!token||!/^[-_a-zA-Z0-9]{43}$/.test(token)||!await store.hasSession(ownerTokenDigest(token)))throw Error('Sign in as the Husher integration owner.');
}
