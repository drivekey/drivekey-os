// Documented provider boundary. Read-only access inspection is separate from order execution.
export const HUSHER_CAPABILITY = Object.freeze({
  provider: 'husher', scope: 'private-route', live: false, standardExchange: {ownerOnly:true,url:'/husher',route:'ethereum-eth-usdc-standard'}, evidence: 'RC19 provider-bound offline signing and standard-exchange synthetic acceptance passed. Real provider settlement and privacy remain unverified',
  documentationCheckedOn: '2026-09-29',
  officialDocumentation: 'https://api-docs.husher.net/api-docs/',
  accessApproval: 'Owner confirmed Husher permission for USD 1000 monthly volume; endpoint behavior still requires verification',
  ownerConfirmedPermission:{currency:'USD',monthlyVolumeLimit:'1000',limitEnforcementVerified:true,agentRealTransactionApproval:false},
  officialApiTerms: 'https://www.husher.io/api-terms',
  missing: [
    'Private-route access and an explicit, correlated refund hash and exact net refund amount.',
    'Private-route minimum payout, maximum fees, refund destination and enforceable expiry guarantees.',
    'Separately verified private execution; standard fixed-rate exchange does not establish privacy.',
  ],
  supportedRoutes: [] as readonly string[],
});

export type PaymentRoute = 'direct' | 'husher';
export type ProviderOperation = 'quote' | 'create-order' | 'export-deposit' | 'refresh-order' | 'submit-deposit';
export interface PaymentProvider {
  capabilities(): typeof HUSHER_CAPABILITY;
  execute(operation: ProviderOperation, input: unknown): Promise<never>;
}
export class ProviderUnavailable extends Error {
  readonly code = 'HUSHER_DISABLED';
  constructor(){super('Husher privacy route unavailable. The standard owner exchange has a separate workflow. No order or payment was created.');}
}
export const husherProvider: PaymentProvider = Object.freeze({
  capabilities: () => HUSHER_CAPABILITY,
  async execute(_operation: ProviderOperation, _input: unknown): Promise<never> { throw new ProviderUnavailable(); },
});

// Conservative planning check for future documented routes; NEVER grants live capability.
export function rebootWindowFits(now:number, quoteExpiry:number, depositDeadline:number, requestExpiry:number, requiredMs:number):boolean {
  return [now,quoteExpiry,depositDeadline,requestExpiry,requiredMs].every(Number.isSafeInteger)
    && requiredMs>0 && Math.min(quoteExpiry,depositDeadline,requestExpiry)-now>=requiredMs;
}
