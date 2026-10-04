import { z } from "zod";
import { metadataSchema, parseJson, publicWallet, requestSchema, validateRequest } from "./protocol";

export const MANUAL_SESSION = "drivekey.manual.v1";
export const attemptSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  state: z.enum(["submitting", "submitted", "pending", "confirmed", "reverted", "unknown", "not-seen", "verified-only"]),
}).strict();
const sessionSchema = z.object({ wallet: metadataSchema, request: requestSchema, attempt: attemptSchema.optional() }).strict();
export type ManualSession = z.infer<typeof sessionSchema>;
export type SendAttempt = z.infer<typeof attemptSchema>;

export function readManualSession(text: string): ManualSession {
  const session = sessionSchema.parse(parseJson(text));
  const wallet = publicWallet(session.wallet);
  // Old signed transactions can still need receipt reconciliation after app expiry.
  const request = validateRequest(session.request, Date.now(), false);
  if (request.from.toLowerCase() !== wallet.address.toLowerCase() || request.deviceId !== wallet.deviceId) throw new Error("Saved request belongs to another wallet.");
  return { wallet, request, attempt: session.attempt };
}

export function saveManualSession(storage: Pick<Storage, "getItem" | "setItem">, session: ManualSession): void {
  const text = JSON.stringify(session);
  readManualSession(text);
  storage.setItem(MANUAL_SESSION, text);
  if (storage.getItem(MANUAL_SESSION) !== text) throw new Error("Could not save the exact request. Nothing will be sent.");
}
