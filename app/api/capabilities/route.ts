import {NextResponse} from 'next/server';
import {PAYMENT_PATHS,LIVE_RELEASE,liveExecutionEnabled} from '@/core/live-release-policy';
import {HUSHER_STANDARD_ACCEPTED,HUSHER_PRIVATE_ACCEPTED} from '@/core/husher-release';
import {rulesRuntime} from '@/core/rules-online';
export const dynamic='force-dynamic';
export async function GET(){
 let agents=false;try{agents=!!rulesRuntime();}catch{/* A broken configuration is not ready. */}
 return NextResponse.json({release:LIVE_RELEASE,paths:PAYMENT_PATHS,ethereum:{configured:!!process.env.ETHEREUM_RPC_URL,settlementVerified:false},solana:{configured:true,authenticatedProvider:!!process.env.JUPITER_API_KEY,settlementVerified:false},lifi:{enabled:liveExecutionEnabled('lifi'),settlementVerified:false},agents:{enabled:liveExecutionEnabled('agents'),configured:agents,settlementVerified:false},husher:{enabled:HUSHER_STANDARD_ACCEPTED,configured:!!(process.env.HUSHER_DATABASE_URL&&process.env.HUSHER_OWNER_TOKEN_SHA256&&process.env.HUSHER_API_KEY&&process.env.ETHEREUM_RPC_URL),ownerOnly:true,privateEnabled:HUSHER_PRIVATE_ACCEPTED,settlementVerified:false}},{headers:{'Cache-Control':'no-store'}});
}
