import { describe, expect, it, beforeAll } from "vitest";
import { Wallet, Transaction } from "ethers";
import { prepareRequest, verifyResponse, validateRequest, fingerprint, TTL_MS, parseJson, preflight, type Rpc, type TransferRequest } from "../core/protocol";
import { createOfflineVault, signOfflineVault, validateVault, checkOfflineVaultPassword, type OfflineVault } from "../offline-signer/vault";

const passphrase = "unfunded automated fixture phrase 2026";
let vault: OfflineVault;
const destination = Wallet.createRandom().address;
export const mockRpc: Rpc = async (method) => {
  switch (method) {
    case "eth_chainId": return "0x1237";
    case "eth_getTransactionCount": return "0x0";
    case "eth_estimateGas": return "0x186a0";
    case "eth_getBlockByNumber": return { baseFeePerGas: "0xf4240" };
    case "eth_maxPriorityFeePerGas": return "0x0";
    case "eth_getCode": return "0x";
    case "eth_getBalance": return "0xde0b6b3a7640000";
    default: throw new Error("Unexpected mock RPC method");
  }
};
const request = () => prepareRequest(vault.public, destination, "0.0001", mockRpc);
beforeAll(async () => { vault = await createOfflineVault(passphrase); });

describe("v2 offline protocol", () => {
  it("checks backup unlock without a transaction or any funds", async () => {
    expect(await checkOfflineVaultPassword(vault, passphrase)).toBe(vault.public.address);
    await expect(checkOfflineVaultPassword(vault, 'wrong fixture passphrase')).rejects.toThrow('Incorrect passphrase');
  });
  it("creates an encrypted bounded keystore and public-only metadata", () => {
    expect(validateVault(vault)).toEqual(vault);
    expect(Object.keys(vault.public).sort()).toEqual(["address", "chainId", "createdAt", "deviceId", "version"]);
    expect(JSON.stringify(vault)).not.toContain(passphrase);
  });
  it("signs offline and independently verifies exact bytes and context", async () => {
    const r = await request(), s = await signOfflineVault(vault, passphrase, r);
    expect(verifyResponse(s, r, vault.public)).toEqual(s);
    expect(Date.parse(r.expiresAt) - Date.parse(r.createdAt)).toBe(TTL_MS);
    expect(Transaction.from(s.rawSignedTransaction).unsignedSerialized).toBe(r.unsignedTransaction);
  });
  it("rejects wrong passwords", async () => {
    await expect(signOfflineVault(vault, "not the correct password", await request())).rejects.toThrow("Incorrect passphrase");
  });
  it("rejects expensive KDF parameters before decryption", () => {
    const corrupt = structuredClone(vault); corrupt.keystore.Crypto.kdfparams.n = 1_073_741_824 as 131072;
    expect(() => validateVault(corrupt)).toThrow();
  });
  it("rejects additional vault fields and mismatched address", () => {
    expect(() => validateVault({ ...vault, privateKey: "not-a-key" })).toThrow();
    expect(() => validateVault({ ...vault, public: { ...vault.public, address: destination } })).toThrow();
  });
  it.each(["to", "value", "nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"])("rejects %s changes even with recomputed fingerprint", async field => {
    const r = await request();
    const modified = { ...r, [field]: field === "to" ? Wallet.createRandom().address : "123" } as TransferRequest;
    modified.fingerprint = fingerprint(modified);
    expect(() => validateRequest(modified)).toThrow();
  });
  it("rejects expired and future requests", async () => {
    const r = await request();
    expect(() => validateRequest(r, Date.parse(r.expiresAt))).toThrow("expired");
    expect(() => validateRequest(r, Date.parse(r.createdAt) - 120_000)).toThrow("clock");
  });
  it("rejects changed request IDs/lifetime even when the EVM signature matches", async () => {
    const r = await request(), s = await signOfflineVault(vault, passphrase, r);
    const changed = { ...r, requestId: crypto.randomUUID() }; changed.fingerprint = fingerprint(changed);
    expect(() => verifyResponse({ ...s, requestId: changed.requestId, fingerprint: changed.fingerprint }, changed, vault.public)).toThrow("approval");
  });
  it("rejects wrong signers, forged approval, and raw hash changes", async () => {
    const r = await request(), s = await signOfflineVault(vault, passphrase, r);
    expect(() => verifyResponse({ ...s, signer: destination }, r, vault.public)).toThrow();
    expect(() => verifyResponse({ ...s, approvalSignature: "0x" + "00".repeat(65) }, r, vault.public)).toThrow();
    expect(() => verifyResponse({ ...s, transactionHash: "0x" + "00".repeat(32) }, r, vault.public)).toThrow();
  });
  it("rejects network, fee ceiling, contract recipients, and insufficient funds", async () => {
    for (const [method, result] of [["eth_chainId", "0x1"], ["eth_getCode", "0x01"], ["eth_getBalance", "0x0"], ["eth_maxPriorityFeePerGas", "0xffffffffff"]]) {
      await expect(prepareRequest(vault.public, destination, "0.0001", (m, p) => m === method ? Promise.resolve(result) : mockRpc(m,p))).rejects.toThrow();
    }
  });
  it("rejects data and access lists in otherwise canonical transactions", async () => {
    const r = await request(), tx = Transaction.from(r.unsignedTransaction); tx.data = "0x0102";
    const changed = { ...r, unsignedTransaction: tx.unsignedSerialized }; changed.fingerprint = fingerprint(changed);
    expect(() => validateRequest(changed)).toThrow("plain");
  });
  it("checks preflight nonce/fee/balance/code changes without modifying bytes", async () => {
    const r = await request(); await preflight(r, mockRpc);
    await expect(preflight(r, (m,p) => m === "eth_getTransactionCount" ? Promise.resolve("0x1") : mockRpc(m,p))).rejects.toThrow("Nonce");
    await expect(preflight(r, (m,p) => m === "eth_estimateGas" ? Promise.resolve("0x989680") : mockRpc(m,p))).rejects.toThrow("fees changed");
  });
  it("rejects corrupted and oversized exchange input", () => {
    expect(() => parseJson("{" )).toThrow("Invalid JSON");
    expect(() => parseJson(" ".repeat(32_769))).toThrow("32 KB");
  });
});
