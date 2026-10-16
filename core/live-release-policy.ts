import {PAYMENT_PATHS as IMPLEMENTED_PATHS, pathForRequest, type PaymentPath} from './payment-readiness';

// Public, build-bound release policy, shared by UI and API. Implementation support
// is not funded acceptance. No environment variable or request can promote it.
// A future approved release must bind its exact artifacts, scope and pilot review.
export const LIVE_RELEASE = Object.freeze({
  stage: 'unfunded-staging' as const,
  fundedExecution: false,
  reason: 'Funded execution is unavailable pending release verification and pilot approval.',
});
export const LIVE_RELEASE_BLOCK = Object.freeze({error: LIVE_RELEASE.reason, code: 'FUNDED_RELEASE_BLOCKED'});
export type LiveServicePath = PaymentPath | 'lifi' | 'agents' | 'weth-conversion';
export function liveExecutionEnabled(_path: LiveServicePath): boolean { return false; }
export const PAYMENT_PATHS = Object.freeze(Object.fromEntries(
  Object.entries(IMPLEMENTED_PATHS).map(([path, value]) => [path, Object.freeze({
    ...value, implementationSupported: value.enabled,
    enabled: value.enabled && liveExecutionEnabled(path as PaymentPath),
  })]),
) as Record<PaymentPath, {enabled: boolean; implementationSupported: boolean; dependency: string}>);
export function paymentExecutionEnabled(input: unknown): boolean {
  const path = pathForRequest(input);
  return path !== null && PAYMENT_PATHS[path].enabled;
}
