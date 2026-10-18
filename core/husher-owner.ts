import {OperationalError} from './service-events';
import 'server-only';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {HusherLedger} from './husher-ledger';
import {approvedAppOrigin} from './app-origin';
export const husherOwnerCookie='__Host-drivekey-husher-owner';
export const ownerTokenDigest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validOwnerOrigin(origin:string|null,expected:string){
 if(!origin||origin!==expected)return false;
 const deploymentHost=process.env.VERCEL_URL;
 // Trust one server-configured deployment, never sibling preview hostnames.
 const deployment=process.env.VERCEL==='1'&&typeof deploymentHost==='string'&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(deploymentHost)&&expected===`https://${deploymentHost}`;
 return approvedAppOrigin(expected)||deployment||(!process.env.VERCEL&&/^http:\/\/127\.0\.0\.1:\d+$/.test(expected));
}
export async function authenticateHusherOwner(code:unknown,expectedHash:string|undefined,store:Pick<HusherLedger,'createSession'>){
 if(!expectedHash||!/^[0-9a-f]{64}$/.test(expectedHash))throw Error('Owner authentication failed.');
 if(typeof code!=='string'||!/^[-_a-zA-Z0-9]{43}$/.test(code)||!expectedHash||!/^[0-9a-f]{64}$/.test(expectedHash)||!timingSafeEqual(Buffer.from(ownerTokenDigest(code),'hex'),Buffer.from(expectedHash,'hex')))throw new OperationalError('Owner authentication failed.','auth-failed');
 const token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+30*60_000);await store.createSession(ownerTokenDigest(token),expires);return {token,expires};
}
export async function requireHusherOwner(token:string|undefined,store:Pick<HusherLedger,'hasSession'>){
 if(!token||!/^[-_a-zA-Z0-9]{43}$/.test(token)||!await store.hasSession(ownerTokenDigest(token)))throw new OperationalError('Sign in as the Husher integration owner.','auth-failed');
}

