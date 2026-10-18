// Public-only local developer transport. The server independently rejects
// hosted/production environments and non-loopback or non-Anvil RPC endpoints.
import {z} from 'zod';
import {savingsReviewExpectationSchema,savingsActionReviewRequestSchema} from '@/core/savings-action-review';
import {savingsTransactionRequestSchema} from '@/core/savings-transaction';
const counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const savingsLocalResultSchema=z.object({
 environment:z.literal('local-anvil-rehearsal'),chainAuthenticated:z.literal(false),independentlyEnrolled:z.literal(false),fundingReady:z.literal(false),productionReady:z.literal(false),
 available:z.boolean().optional(),status:z.enum(['submission-uncertain','reconciliation-required','reverted','local-vault-created','local-action-queued','local-operation-observed']).optional(),
 transactionHash:z.string().regex(/^0x[0-9a-f]{64}$/).optional(),identity:savingsReviewExpectationSchema.optional(),
 request:z.union([savingsTransactionRequestSchema,savingsActionReviewRequestSchema]).optional(),
 queue:z.object({provenance:z.literal('host-rpc'),actionId:z.string().regex(/^0x[0-9a-f]{64}$/),queuedAt:counter,readyAt:counter,expiry:counter,epoch:counter,status:z.enum(['queued','unavailable'])}).strict().nullable().optional(),
}).strict();
export type SavingsLocalResult=z.infer<typeof savingsLocalResultSchema>;
export async function savingsLocalCall(action:string,input?:unknown){
 const response=await fetch('/api/savings/rehearsal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input}),cache:'no-store',signal:AbortSignal.timeout(30000)});
 const body:unknown=await response.json();if(!response.ok)throw Error(typeof body==='object'&&body!==null&&'error' in body&&typeof body.error==='string'?body.error:'Local rehearsal unavailable.');
 return savingsLocalResultSchema.parse(body);
}
