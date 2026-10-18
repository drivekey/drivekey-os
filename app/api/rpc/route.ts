import {withServiceTelemetry} from '@/core/server-service-telemetry';
import {createRpcProxy} from '@/core/rpc-proxy';
import {serviceRateLimitHttp} from '@/core/service-rate-limit-http';
export const runtime = 'nodejs';
export const POST = withServiceTelemetry('rpc',createRpcProxy(process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',{
 admit:id=>serviceRateLimitHttp('rpc',(_body,status)=>Response.json({jsonrpc:'2.0',id,error:{code:status===429?-32005:-32000,message:status===429?'RPC request limit reached':'RPC admission unavailable'}},{status,headers:{'Cache-Control':'no-store'}})),
}));
