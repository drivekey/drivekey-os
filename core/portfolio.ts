import { z } from "zod";
export const holdingSchema = z.object({ id: z.string().max(100), network: z.enum(["robinhood", "solana"]), address: z.string().max(64), symbol: z.string().max(64), name: z.string().max(64), quantity: z.string().max(78).regex(/^(0|[1-9][0-9]*)$/), decimals: z.number().int().min(0).max(36), supported: z.boolean(), warning: z.string().max(400).optional(), updatedAt: z.string().datetime(), price: z.object({ usdMicros: z.string().max(30).regex(/^(0|[1-9][0-9]*)$/), timestamp: z.string().datetime(), confidence: z.enum(["high", "low"]) }).strict().nullable(), error: z.string().max(200).optional() }).strict();
export type Holding = z.infer<typeof holdingSchema>;
export function allocation(input: Holding[], now: number) {
  const seen = new Set<string>();
  const items = input.slice(0, 200).map(item => {
    const h = holdingSchema.parse(item); if (seen.has(h.id)) throw new Error("Duplicate asset identity."); seen.add(h.id);
    const stale = !!h.price && (now - Date.parse(h.price.timestamp) > 5 * 60_000 || Date.parse(h.price.timestamp) > now + 60_000);
    const usable = !h.error && h.price !== null && h.price.confidence === "high" && !stale;
    const value = usable ? BigInt(h.quantity) * BigInt(h.price!.usdMicros) / 10n ** BigInt(h.decimals) : null;
    return { ...h, value, stale };
  });
  const total = items.reduce((sum, h) => sum + (h.value ?? 0n), 0n);
  const partial = items.some(h => (BigInt(h.quantity) > 0n || !!h.error) && h.value === null);
  return { total, partial, items: items.map(h => ({ ...h, share: h.value !== null && total > 0n ? Number(h.value * 1_000_000n / total) / 1_000_000 : null })) };
}
export function usd(value: bigint): string {
  return "$" + (value / 1_000_000n).toLocaleString("en-US") + "." + ((value % 1_000_000n) / 10_000n).toString().padStart(2, "0");
}
