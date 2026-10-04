const fallback='https://drivekey-app.vercel.app';
function safeOrigin(value:string){const u=new URL(value);if(u.origin!==value||u.protocol!=='https:'||u.username||u.password)throw Error('Invalid canonical app origin');return u.origin;}
export const APP_ORIGIN=safeOrigin(process.env.NEXT_PUBLIC_APP_ORIGIN||fallback);
export function approvedAppOrigin(origin:string|null){return origin!==null&&[APP_ORIGIN,fallback,'https://drivekey.info'].includes(origin);}
