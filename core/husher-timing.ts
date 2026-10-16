// Scheduling policy only. Ethereum native-transfer signatures have no on-chain
// expiry; these checks never claim to revoke signed bytes or extend provider terms.
export const HUSHER_MIN_OFFLINE_WINDOW_MS = 15 * 60_000;
export const HUSHER_SUBMISSION_BUFFER_MS = 2 * 60_000;
export const HUSHER_MAX_REQUEST_WINDOW_MS = 30 * 60_000;
export const HUSHER_OFFLINE_WINDOW_ERROR = 'Not enough time for offline approval. At least 15 minutes, or your measured round trip plus 2 minutes, must remain. Recover this order; do not recreate it automatically.';
export const HUSHER_SUBMISSION_WINDOW_ERROR = 'Less than 2 minutes remain before a signed or provider deadline. Deposit stopped. Keep the signed transaction private and reconcile this order; expiry does not revoke it.';
export const HUSHER_MEASUREMENT_ERROR = 'The measured offline round trip does not fit the 30-minute approval limit. No deadline was extended.';

export function husherOfflineWindowMs(measuredOfflineDurationMs?: number): number {
  if (measuredOfflineDurationMs === undefined) return HUSHER_MIN_OFFLINE_WINDOW_MS;
  if (!Number.isSafeInteger(measuredOfflineDurationMs) || measuredOfflineDurationMs <= 0 ||
      measuredOfflineDurationMs + HUSHER_SUBMISSION_BUFFER_MS >= HUSHER_MAX_REQUEST_WINDOW_MS) {
    throw Error(HUSHER_MEASUREMENT_ERROR);
  }
  return Math.max(HUSHER_MIN_OFFLINE_WINDOW_MS, measuredOfflineDurationMs + HUSHER_SUBMISSION_BUFFER_MS);
}

export function requireHusherWindow(deadlines: readonly string[], now: number, requiredMs: number, phase: 'offline' | 'submission') {
  if (!deadlines.length || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(requiredMs) || requiredMs <= 0) throw Error('Invalid Husher timing policy.');
  const times = deadlines.map(value => Date.parse(value));
  if (times.some(value => !Number.isSafeInteger(value)) || Math.min(...times) - now < requiredMs) {
    throw Error(phase === 'offline' ? HUSHER_OFFLINE_WINDOW_ERROR : HUSHER_SUBMISSION_WINDOW_ERROR);
  }
}

export function husherRequestDeadlines(request: {payment: {expiresAt: string}; terms: {depositDeadline: string; rateLockExpiresAt: string; orderExpiresAt: string}}) {
  return [request.payment.expiresAt, request.terms.depositDeadline, request.terms.rateLockExpiresAt, request.terms.orderExpiresAt];
}
