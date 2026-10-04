import { getAddress, ZeroAddress } from "ethers";
import { PublicKey } from "@solana/web3.js";

export type AssetNetwork = "robinhood" | "solana";
export function assetIdentity(network: AssetNetwork, address: string): string {
  if (address === "native") return `${network}:native`;
  if (network === "robinhood") {
    const normalized = getAddress(address);
    if (normalized === ZeroAddress) throw new Error("Zero token address is not allowed.");
    return `${network}:${normalized.toLowerCase()}`;
  }
  const normalized = new PublicKey(address).toBase58();
  if (normalized !== address) throw new Error("Noncanonical mint address.");
  return `${network}:${normalized}`;
}

/** Metadata is presentation only, never authority to sign. Do not fetch token image URLs. */
export function assetLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 64);
  return cleaned || fallback;
}
