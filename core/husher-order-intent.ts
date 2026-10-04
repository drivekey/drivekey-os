// Server orchestration contract. The store implementation MUST atomically persist
// account-wide reservations before network work; a browser/localStorage is insufficient.
import {z} from 'zod';
import {husherOrderPlanSchema} from './husher-create';
const amount=z.string().max(30).regex(/^(0|[1-9][0-9]*)$/);
export const husherCreationIntentSchema=z.object({version:z.literal(1),id:z.string().uuid(),externalUserId:z.string().regex(/^drivekey-[0-9a-f-]{36}$/),
 fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),reservationUsdMicros:amount,
 state:z.enum(['unknown','created']),orderId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),plan:husherOrderPlanSchema.optional()}).strict();
export type HusherCreationIntent=z.infer<typeof husherCreationIntentSchema>;
export interface HusherIntentStore {
 // Serializable account-wide transaction. insertIfBudgetAvailable must reject
 // unreconciled usage and reserve at most the authorized USD 1000 monthly total.
 reserveOnce(intent:HusherCreationIntent,monthlyLimitUsdMicros:'1000000000'):Promise<{inserted:boolean;intent:HusherCreationIntent}>;
 read(id:string):Promise<HusherCreationIntent|null>;
 markCreated(id:string,fingerprint:string,orderId:string):Promise<void>;
}
// Exactly one create attempt per persisted intent. No retry for timeouts, errors,
// malformed responses, absent lookup results or failures saving the response.
export async function createHusherOrderOnce(input:unknown,store:HusherIntentStore,create:()=>Promise<unknown>,accepted:boolean){
 if(!accepted)throw Error('Husher order creation has not passed release acceptance.');
 const requested=husherCreationIntentSchema.parse(input);
 if(requested.state!=='unknown'||requested.orderId||requested.externalUserId!=='drivekey-'+requested.id||BigInt(requested.reservationUsdMicros)<=0n||BigInt(requested.reservationUsdMicros)>1000000000n||requested.month!==new Date().toISOString().slice(0,7))throw Error('Invalid provider creation reservation.');
 const reservation=await store.reserveOnce(requested,'1000000000');
 const saved=husherCreationIntentSchema.parse(reservation.intent);
 if(saved.id!==requested.id||saved.externalUserId!==requested.externalUserId||saved.fingerprint!==requested.fingerprint||saved.month!==requested.month||saved.reservationUsdMicros!==requested.reservationUsdMicros)throw Error('Another provider intent occupies this reservation.');
 if(!reservation.inserted)return {state:saved.state,orderId:saved.orderId,canRetryCreate:false};
 const readBack=husherCreationIntentSchema.parse(await store.read(requested.id));
 if(JSON.stringify(readBack)!==JSON.stringify(requested))throw Error('Provider creation intent was not durably verified.');
 try{
  const response=z.object({success:z.literal(true),data:z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)})}).parse(await create());
  await store.markCreated(requested.id,requested.fingerprint,response.data.id);
  const final=husherCreationIntentSchema.parse(await store.read(requested.id));
  if(final.state!=='created'||final.orderId!==response.data.id||final.fingerprint!==requested.fingerprint)throw Error('Order identity was not durably saved.');
  return {state:'created' as const,orderId:response.data.id,canRetryCreate:false};
 }catch{return {state:'unknown' as const,canRetryCreate:false,externalUserId:requested.externalUserId,message:'Creation outcome unknown. Reconcile the saved correlation ID; never create again automatically.'};}
}
