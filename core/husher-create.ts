import 'server-only';
import {z} from 'zod';
import {getAddress,parseUnits,formatUnits,keccak256,toUtf8Bytes} from 'ethers';
const decimal=z.string().max(40).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const address=z.string().transform(v=>getAddress(v)).refine(v=>v!=='0x0000000000000000000000000000000000000000');
export const husherOrderPlanSchema=z.object({
 version:z.literal(1),route:z.literal('eth-usdc'),orderType:z.literal('normal'),privacy:z.literal(false),
 id:z.string().uuid(),payoutAddress:address,refundAddress:address,
 exactReceiveAmount:decimal,maximumSendAmount:decimal,maximumProviderFees:decimal,
}).strict().superRefine((v,c)=>{
 try{if(parseUnits(v.exactReceiveAmount,6)<=0n||parseUnits(v.exactReceiveAmount,6)>1000000000n||parseUnits(v.maximumSendAmount,18)<=0n||parseUnits(v.maximumSendAmount,18)>10n**19n||parseUnits(v.maximumProviderFees,6)>1000000000n)throw Error();}
 catch{c.addIssue({code:'custom',message:'Unsupported exact Husher amount or fee cap.'});}
});
export type HusherOrderPlan=z.infer<typeof husherOrderPlanSchema>;
export function husherOrderPlanFingerprint(input:unknown){const p=husherOrderPlanSchema.parse(input);return keccak256(toUtf8Bytes(JSON.stringify(['DriveKey Husher standard creation v1',p.id,p.route,p.orderType,p.privacy,p.payoutAddress,p.refundAddress,parseUnits(p.exactReceiveAmount,6).toString(),parseUnits(p.maximumSendAmount,18).toString(),parseUnits(p.maximumProviderFees,6).toString()])));}

// Caller MUST reserve and read-verify a durable intent first. This adapter never retries.
export async function createHusherStandardOrder(input:unknown,key:string|undefined,fetcher:typeof fetch=fetch){
 const p=husherOrderPlanSchema.parse(input);
 if(!key||key.length>4096||/[\r\n]/.test(key))throw Error('Private Husher credential unavailable.');
 const amount=Number(p.exactReceiveAmount);
 if(parseUnits(String(amount),6)!==parseUnits(p.exactReceiveAmount,6))throw Error('Provider numeric amount would lose precision.');
 const body={send:'ETH',sendNetwork:'ETH',receive:'USDC',receiveNetwork:'ETH',receiveAddress:p.payoutAddress,refundAddress:p.refundAddress,amount,amountType:'receive',fixedRate:true,externalUserId:'drivekey-'+p.id};
 try{
  const response=await fetcher('https://api.husher.net/api/v1/husher/create',{method:'POST',headers:{'x-api-key':key,'Content-Type':'application/json',accept:'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error();const reader=response.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();if(text.includes(key))throw Error();
  const result=z.object({success:z.literal(true),data:z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),sendAddress:address,sendNetwork:z.literal('ETH'),sendToken:z.literal('ETH'),sendAmount:decimal,receiveAmount:decimal,fixedRate:z.literal(true),status:z.literal('pending'),depositDeadline:z.string().datetime({offset:true}),rateLockExpiresAt:z.string().datetime({offset:true}),orderExpiresAt:z.string().datetime({offset:true})})}).parse(JSON.parse(text));
  const t=result.data;
  if(parseUnits(t.sendAmount,18)<=0n||parseUnits(t.sendAmount,18)>parseUnits(p.maximumSendAmount,18)||parseUnits(t.receiveAmount,6)!==parseUnits(p.exactReceiveAmount,6)||[p.payoutAddress,p.refundAddress].includes(t.sendAddress)||Math.min(Date.parse(t.depositDeadline),Date.parse(t.rateLockExpiresAt),Date.parse(t.orderExpiresAt))<Date.now()+60000)throw Error();
  return {success:true as const,data:{id:t.id}};
 }catch{throw Error('Husher creation outcome needs reconciliation. Never repeat this creation automatically.');}
}
