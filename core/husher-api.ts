import 'server-only';
import {z} from 'zod';
import {parseUnits} from 'ethers';
import {husherFixedIntent, inspectFixedOrderTerms} from './husher-fixed-terms';
import {inspectHusherAssets} from './husher-assets';
// Only documented GET operations. No order/deposit/withdrawal operation is exposed.
const API='https://api.husher.net';
class HusherReadError extends Error {}
async function readHusher(path:'/api/v1/husher/currencies'|'/api/v1/husher/rate'|`/api/v1/husher/status/${string}`|`/api/v1/user/api-key-orders/external-user/${string}`,key:string|undefined,query:URLSearchParams|undefined,fetcher:typeof fetch){
 if(!key||key.length>4096||/[\r\n]/.test(key))throw new HusherReadError('HUSHER_API_KEY is not configured in private server configuration.');
 try{
  const response=await fetcher(API+path+(query?'?'+query:''),{method:'GET',headers:{'x-api-key':key,accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new HusherReadError(response.status===401||response.status===403?'Husher rejected read access. Check the key and API permissions.':'Husher read service unavailable. No order was created.');
  const reader=response.body?.getReader();if(!reader)throw new HusherReadError('Missing Husher response.');
  let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw new HusherReadError('Husher response exceeds limits.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
  if(text.includes(key))throw new HusherReadError('Husher returned an unsafe response. No order was created.');
  const body:unknown=JSON.parse(text);
  if(!body||typeof body!=='object'||!('success' in body)||body.success!==true||!('data' in body))throw new HusherReadError('Husher did not acknowledge read access.');
  return body.data;
 }catch(error){if(error instanceof HusherReadError)throw error;throw new HusherReadError('Husher read check failed. No order was created.');}
}
export async function inspectHusherAccess(key:string|undefined,fetcher:typeof fetch=fetch){
 await readHusher('/api/v1/husher/currencies',key,undefined,fetcher);
 // Currencies have no documented response schema. Never forward opaque provider data.
 return {authenticated:true,privacyEnabled:false,ordersEnabled:false,certifiedRoutes:[],missing:['Verify canonical network, contract/mint and decimal identities','Verify private-order API-key permissions','Provider-bound offline approval requires a new ISO']};
}
export async function inspectHusherAssetAccess(key:string|undefined,fetcher:typeof fetch=fetch){
 const raw=await readHusher('/api/v1/husher/currencies',key,undefined,fetcher);
 try{return inspectHusherAssets(raw);}catch{throw new HusherReadError('Husher supported asset identities did not verify. No order was created.');}
}
// Internal server evidence only. Never expose opaque provider data to the browser.
export async function readHusherOrder(orderId:string,key:string|undefined,fetcher:typeof fetch=fetch){
 z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).parse(orderId);
 return readHusher(`/api/v1/husher/status/${orderId}`,key,undefined,fetcher);
}
export async function readHusherCorrelatedOrders(externalUserId:string,key:string|undefined,fetcher:typeof fetch=fetch){
 z.string().regex(/^drivekey-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).parse(externalUserId);
 return readHusher(`/api/v1/user/api-key-orders/external-user/${externalUserId}`,key,new URLSearchParams({page:'1',limit:'100'}),fetcher);
}
const decimal=z.string().max(80).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const routes={
 'sol-usdc':{sendToken:'SOL',receiveToken:'USDC',sendNetwork:'SOL',receiveNetwork:'SOL',sendDecimals:9,receiveDecimals:6},
 'usdc-sol':{sendToken:'USDC',receiveToken:'SOL',sendNetwork:'SOL',receiveNetwork:'SOL',sendDecimals:6,receiveDecimals:9},
 'eth-usdc':{sendToken:'ETH',receiveToken:'USDC',sendNetwork:'ETH',receiveNetwork:'ETH',sendDecimals:18,receiveDecimals:6},
} as const;
export const husherRateInput=z.object({route:z.enum(['sol-usdc','usdc-sol','eth-usdc']),amount:decimal}).strict();
const rateSchema=z.object({sendToken:z.string(),receiveToken:z.string(),sendAmount:decimal,receiveAmount:decimal,minimumSendAmount:decimal,feeAmount:decimal,networkFee:decimal,estimatedTimeSeconds:z.number().int().nonnegative().max(86400),withdrawLimits:z.object({sendToken:z.object({coin:z.string(),network:z.string()}).nullable().optional(),receiveToken:z.object({coin:z.string(),network:z.string()}).nullable().optional()}).optional()});
function units(value:string,decimals:number){const clean=value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;return parseUnits(clean,decimals);}
export async function inspectHusherPrivateRate(input:unknown,key:string|undefined,fetcher:typeof fetch=fetch){
 let a:z.infer<typeof husherRateInput>,amount:bigint;
 try{a=husherRateInput.parse(input);amount=units(a.amount,routes[a.route].sendDecimals);if(amount<=0n||amount>=2n**128n)throw Error();}
 catch{throw new HusherReadError('Unsupported Husher rate route or exact amount.');}
 const route=routes[a.route];
 const query=new URLSearchParams({sendToken:route.sendToken,receiveToken:route.receiveToken,sendNetwork:route.sendNetwork,receiveNetwork:route.receiveNetwork,sendAmount:a.amount,amountType:'send',provider:'private'});
 const raw=await readHusher('/api/v1/husher/rate',key,query,fetcher);
 try{
  const data=rateSchema.parse(raw);
  if(data.sendToken!==route.sendToken||data.receiveToken!==route.receiveToken||units(data.sendAmount,route.sendDecimals)!==amount||units(data.receiveAmount,route.receiveDecimals)<=0n)throw Error();
  for(const [value,coin,network] of [[data.withdrawLimits?.sendToken,route.sendToken,route.sendNetwork],[data.withdrawLimits?.receiveToken,route.receiveToken,route.receiveNetwork]] as const)if(value&&(value.coin!==coin||value.network!==network))throw Error();
  return {provider:'husher',rateType:'private',route:a.route,sendToken:route.sendToken,receiveToken:route.receiveToken,sendNetwork:route.sendNetwork,receiveNetwork:route.receiveNetwork,sendAmount:a.amount,estimatedReceiveAmount:data.receiveAmount,estimatedFeeAmount:data.feeAmount,estimatedNetworkFee:data.networkFee,minimumSendAmount:data.minimumSendAmount,estimatedTimeSeconds:data.estimatedTimeSeconds,networkEchoVerified:!!data.withdrawLimits?.sendToken&&!!data.withdrawLimits?.receiveToken,canonicalAssetsVerified:false,privateOrderPermissionVerified:false,minimumPayoutGuaranteed:false,ordersEnabled:false,privacyEnabled:false,signingEnabled:false,notice:'Read-only estimate. No guaranteed minimum payout, fee ceiling or expiry; no signable request or order was created.'};
 }catch{throw new HusherReadError('Husher rate response does not match the requested assets, networks or exact amount. No order was created.');}
}

// Use a locally persisted unique correlation ID before creation. Empty lookup never authorizes retry.
const recoveryInput=husherRateInput.extend({externalUserId:z.string().regex(/^drivekey-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),recipient:z.string().min(32).max(64),orderType:z.enum(['private','normal']).default('private')}).strict();
const candidateSchema=z.object({type:z.enum(['private','normal']),orderId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),externalUserId:z.string(),sendToken:z.string(),sendNetwork:z.string(),sendAmount:decimal,receiveToken:z.string(),receiveNetwork:z.string(),receiveAddress:z.string(),isSplitOrder:z.literal(false).optional()});
const orderPage=z.object({orders:z.array(z.unknown()).max(100),pagination:z.object({page:z.literal(1),limit:z.literal(100),total:z.number().int().nonnegative(),totalPages:z.number().int().nonnegative()})});
export async function inspectHusherCreateRecovery(input:unknown,key:string|undefined,fetcher:typeof fetch=fetch){
 let a:z.infer<typeof recoveryInput>;
 try{a=recoveryInput.parse(input);if(units(a.amount,routes[a.route].sendDecimals)<=0n)throw Error();}catch{throw new HusherReadError('Invalid locally correlated Husher recovery intent.');}
 const raw=await readHusher(`/api/v1/user/api-key-orders/external-user/${a.externalUserId}`,key,new URLSearchParams({page:'1',limit:'100'}),fetcher);
 const closed={canRetryCreate:false,signingEnabled:false,ordersEnabled:false,privacyEnabled:false,settlementVerified:false};
 try{
  const page=orderPage.parse(raw);
  if(page.pagination.total!==page.orders.length||page.pagination.totalPages>1)return {...closed,state:'unresolved',reason:'Incomplete order lookup; do not repeat creation.'};
  if(page.orders.length===0)return {...closed,state:'unresolved',reason:'No order visible yet; absence is not proof that creation failed. Do not retry.'};
  if(page.orders.length!==1)return {...closed,state:'ambiguous',reason:'Multiple orders share the correlation ID. Manual reconciliation required.'};
  const order=candidateSchema.parse(page.orders[0]),route=routes[a.route];
  if(order.type!==a.orderType||(order.type==='private'&&order.isSplitOrder!==false))throw Error();
  const recipientMatches=route.receiveNetwork==='ETH'?order.receiveAddress.toLowerCase()===a.recipient.toLowerCase():order.receiveAddress===a.recipient;
  if(order.externalUserId!==a.externalUserId||order.sendToken!==route.sendToken||order.receiveToken!==route.receiveToken||order.sendNetwork!==route.sendNetwork||order.receiveNetwork!==route.receiveNetwork||units(order.sendAmount,route.sendDecimals)!==units(a.amount,route.sendDecimals)||!recipientMatches)throw Error();
  return {...closed,state:'candidate-found',orderId:order.orderId,reason:'One matching order found. Fetch and verify full provider terms and chain evidence before any approval.'};
 }catch{throw new HusherReadError('Husher recovery response does not match the saved intent. Do not repeat creation.');}
}

// Read-only inspection of an already correlated standard order. Never creates an order,
// exports signing bytes, or promotes provider status to chain settlement evidence.
export async function inspectHusherFixedOrder(input:unknown,key:string|undefined,now:number,fetcher:typeof fetch=fetch){
 let intent:z.infer<typeof husherFixedIntent>;
 try{intent=husherFixedIntent.parse(input);}catch{throw new HusherReadError('Invalid Husher fixed-order inspection intent.');}
 const raw=await readHusher(`/api/v1/husher/status/${intent.orderId}`,key,undefined,fetcher);
 try{return inspectFixedOrderTerms(intent,raw,now);}catch{throw new HusherReadError('Husher fixed-order terms are incomplete or differ from the saved intent. Signing remains disabled.');}
}
