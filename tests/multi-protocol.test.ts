import { beforeAll, describe, expect, it } from "vitest";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { Transaction, Wallet, keccak256 } from "ethers";
import { createMultiVault, signMultiVault, unlockMultiVault, upgradeMultiVault, type MultiVault } from "../offline-signer/multi-vault";
import { createOfflineVault } from "../offline-signer/vault";
import { MULTI_TTL, SOLANA_GENESIS, ERC20, canonicalSolTransaction, encodeSolUnsigned, multiFingerprint, validateMultiRequest, verifyMultiResponse, type ErcRequest, type SolRequest } from "../core/multi-protocol";
import { assetIdentity, assetLabel } from "../core/asset-identity";
import { inspectErc20, prepareErc20, preflightErc20 } from "../core/multi-online";
import type { Rpc } from "../core/protocol";
const phrase = "unfunded multichain fixture only 2026";
let vault: MultiVault;
const now = Date.now();
function context() { return { version: 3 as const, requestId: crypto.randomUUID(), deviceId: vault.public.deviceId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MULTI_TTL).toISOString(), fingerprint: "0x" + "00".repeat(32) }; }
function erc(): ErcRequest {
  const token = Wallet.createRandom().address, recipient = Wallet.createRandom().address;
  const tx = Transaction.from({ type: 2, chainId: 4663, to: token, value: 0n, nonce: 0, gasLimit: 80000, maxFeePerGas: 1000000, maxPriorityFeePerGas: 0, data: ERC20.encodeFunctionData("transfer", [recipient, 1234567n]) });
  const r: ErcRequest = { ...context(), network: "robinhood", chainId: 4663, standard: "erc20", from: vault.public.evmAddress, recipient, token, amount: "1234567", decimals: 6, codeHash: keccak256("0x6000"), unsignedTransaction: tx.unsignedSerialized };
  r.fingerprint = multiFingerprint(r); return r;
}
function sol(spl = false, create = false): SolRequest {
  const r: SolRequest = { ...context(), network: "solana", genesisHash: SOLANA_GENESIS, standard: spl ? "spl" : "native", from: vault.public.solanaAddress, recipient: Keypair.generate().publicKey.toBase58(), token: spl ? Keypair.generate().publicKey.toBase58() : "native", amount: "100000", decimals: spl ? 6 : 9, nonceAccount: Keypair.generate().publicKey.toBase58(), nonceValue: Keypair.generate().publicKey.toBase58(), maximumFee: "5000", accountRent: create ? "2039280" : "0", createRecipientAccount: create, unsignedTransaction: "" };
  r.unsignedTransaction = encodeSolUnsigned(canonicalSolTransaction(r)); r.fingerprint = multiFingerprint(r); return r;
}
beforeAll(async () => { vault = await createMultiVault(phrase); }, 30_000);
describe("multi-chain cryptographic fixtures — no blockchain execution", () => {
  it("separate encrypted keys recover the same public identities", async () => {
    const keys = await unlockMultiVault(structuredClone(vault), phrase);
    expect(keys.evm.address).toBe(vault.public.evmAddress); expect(keys.sol.publicKey.toBase58()).toBe(vault.public.solanaAddress);
    expect(Buffer.from(keys.sol.secretKey.subarray(0,32)).toString("hex")).not.toBe(keys.evm.privateKey.slice(2));
    expect(JSON.stringify(vault)).not.toContain(phrase); keys.sol.secretKey.fill(0);
  });
  it("wrong password and modified public metadata fail authenticated decryption", async () => {
    await expect(unlockMultiVault(vault, "wrong unfunded fixture password")).rejects.toThrow("Incorrect passphrase");
    await expect(unlockMultiVault({ ...vault, public: { ...vault.public, deviceId: crypto.randomUUID() } }, phrase)).rejects.toThrow("Incorrect passphrase");
  });
  it("rejects costly KDF and additional fields before decryption", async () => {
    await expect(unlockMultiVault({ ...vault, kdf: "scrypt-999999999-8-1" }, phrase)).rejects.toThrow();
    await expect(unlockMultiVault({ ...vault, password: phrase }, phrase)).rejects.toThrow();
  });
  it("explicit v2 upgrade preserves original bytes, device and funded-address identity", async () => {
    const old = await createOfflineVault(phrase), before = JSON.stringify(old);
    await expect(upgradeMultiVault(old, phrase, false)).rejects.toThrow("consent");
    const upgraded = await upgradeMultiVault(old, phrase, true);
    expect(upgraded.public.evmAddress).toBe(old.public.address); expect(upgraded.public.deviceId).toBe(old.public.deviceId); expect(JSON.stringify(old)).toBe(before);
  }, 30_000);
  it.each(["erc20", "SOL", "SPL", "SPL+ATA"])("signs and independently verifies exact %s bytes", async kind => {
    const r = kind === "erc20" ? erc() : sol(kind.startsWith("SPL"), kind.includes("ATA"));
    const s = await signMultiVault(vault, phrase, r, now);
    expect(verifyMultiResponse(s, r, vault.public, now)).toEqual(s);
    const changed = { ...r, requestId: crypto.randomUUID() }; changed.fingerprint = multiFingerprint(changed);
    expect(() => verifyMultiResponse({ ...s, requestId: changed.requestId, fingerprint: changed.fingerprint }, changed, vault.public, now)).toThrow();
  });
  it.each(["amount", "recipient", "token"])("rejects ERC20 %s tampering even after rehash", field => {
    const r = erc(), changed = { ...r, [field]: field === "amount" ? "1" : Wallet.createRandom().address }; changed.fingerprint = multiFingerprint(changed);
    expect(() => validateMultiRequest(changed, now)).toThrow();
  });
  it("rejects appended calldata, approvals, native value and wrong chain", () => {
    for (const mutate of [(t: Transaction) => { t.data += "00"; }, (t: Transaction) => { t.value = 1n; }, (t: Transaction) => { t.chainId = 1n; }, (t: Transaction) => { t.data = "0x095ea7b3" + "00".repeat(64); }]) {
      const r = erc(), tx = Transaction.from(r.unsignedTransaction); mutate(tx); r.unsignedTransaction = tx.unsignedSerialized; r.fingerprint = multiFingerprint(r);
      expect(() => validateMultiRequest(r, now)).toThrow();
    }
  });
  it("rejects unknown extra Solana transfer instructions", () => {
    const r = sol(), tx = canonicalSolTransaction(r);
    tx.add(SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
    r.unsignedTransaction = encodeSolUnsigned(tx); r.fingerprint = multiFingerprint(r);
    expect(() => validateMultiRequest(r, now)).toThrow("unsupported");
  });
  it.each(["amount", "recipient", "token", "decimals", "nonceAccount", "nonceValue", "genesisHash"])("rejects SPL %s tampering", field => {
    const r = sol(true), changed = { ...r, [field]: field === "amount" ? "3" : field === "decimals" ? 9 : Keypair.generate().publicKey.toBase58() }; changed.fingerprint = multiFingerprint(changed);
    expect(() => validateMultiRequest(changed, now)).toThrow();
  });
  it("durable message survives hours offline but application expiry is enforced", () => {
    const r = sol(); expect(validateMultiRequest(r, now + 4 * 60 * 60_000)).toEqual(r);
    expect(() => validateMultiRequest(r, now + MULTI_TTL)).toThrow("expired");
  });
  it("identity is chain + address, and presentation strips terminal/bidi controls", () => {
    expect(assetIdentity("robinhood", "native")).not.toBe(assetIdentity("solana", "native"));
    expect(assetLabel("\u001bTOKEN\u202e", "unknown")).toBe("TOKEN");
  });
});

describe("ERC20 controlled RPC fixtures — not validator execution", () => {
  const rpc: Rpc = async (method, params = []) => {
    if (method === "eth_call") {
      const data = (params[0] as {data:string}).data, parsed = ERC20.parseTransaction({data})!;
      const values: Record<string, unknown> = { decimals: 6, balanceOf: 1000000000n, symbol: "MEME", name: "Fixture meme", transfer: true };
      return ERC20.encodeFunctionResult(parsed.name, [values[parsed.name]]);
    }
    return ({ eth_chainId: "0x1237", eth_getCode: "0x6000", eth_getTransactionCount: "0x0", eth_estimateGas: "0x13880", eth_getBlockByNumber: {baseFeePerGas:"0xf4240"}, eth_maxPriorityFeePerGas:"0x0", eth_getBalance:"0xde0b6b3a7640000" } as Record<string,unknown>)[method];
  };
  it("imports token data without signing and prepares exact token transfer", async () => {
    const token = Wallet.createRandom().address, recipient = Wallet.createRandom().address;
    expect(await inspectErc20(rpc,token,vault.public.evmAddress)).toMatchObject({decimals:6,symbol:"MEME"});
    const r = await prepareErc20(vault.public,token,recipient,"1.5",rpc); expect(r.amount).toBe("1500000"); await preflightErc20(r,rpc);
    await expect(preflightErc20(r,(m,p)=>m==="eth_getTransactionCount"?Promise.resolve("0x1"):rpc(m,p))).rejects.toThrow("Nonce");
    await expect(preflightErc20(r,(m,p)=>m==="eth_getCode"?Promise.resolve("0x6001"):rpc(m,p))).rejects.toThrow("changed");
  });
  it("rejects false-return tokens and missing ETH gas", async () => {
    const token = Wallet.createRandom().address, recipient = Wallet.createRandom().address;
    await expect(prepareErc20(vault.public,token,recipient,"1",(m,p)=>m==="eth_getBalance"?Promise.resolve("0x0"):rpc(m,p))).rejects.toThrow("Insufficient ETH");
    await expect(prepareErc20(vault.public,token,recipient,"10000",rpc)).rejects.toThrow("Insufficient token");
  });
});
