import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Wallet } from "ethers";
import { FILES, prepareRequest, verifyResponse, type Rpc, type TransferRequest, type PublicWallet } from "../core/protocol";
import { writeJsonFile, readJsonFile } from "../core/files";
import { guiAction, safeGuiError } from "../offline-signer/gui-service";
import { assertOfflineEnvironment } from "../offline-signer/environment";
import { readManualSession, saveManualSession, MANUAL_SESSION } from "../core/manual-session";
// Only tests replace the guard. The production worker has no fixture/bypass switch.
vi.mock("../offline-signer/environment", () => ({ assertOfflineEnvironment: vi.fn(async () => {}) }));
const phrase = "unfunded GUI test fixture unique phrase";
const rpc: Rpc = async m => ({ eth_chainId: "0x1237", eth_getTransactionCount: "0x0", eth_estimateGas: "0x186a0", eth_getBlockByNumber: { baseFeePerGas: "0xf4240" }, eth_maxPriorityFeePerGas: "0x0", eth_getCode: "0x", eth_getBalance: "0xde0b6b3a7640000" })[m];
let directory: string, wallet: PublicWallet, request: TransferRequest;
beforeAll(async () => {
  const parent = resolve("outputs/test-fixtures"); await mkdir(parent, { recursive: true });
  directory = await mkdtemp(join(parent, "gui-v3-"));
});
afterAll(async () => { if (directory.startsWith(resolve("outputs/test-fixtures") + require("node:path").sep)) await rm(directory, { recursive: true, force: true }); });
describe.sequential("offline GUI protocol with unfunded fixtures", () => {
  it("finds an empty exchange directory and never returns secret data", async () => {
    expect(await guiAction({ action: "status" }, directory)).toMatchObject({ wallet: null, network: "disabled" });
  });
  it("refuses mismatched confirmation without writing; retry creates a vault", async () => {
    await expect(guiAction({ action: "create", password: phrase, confirmation: "wrong", consent: true }, directory)).rejects.toThrow("Passphrases differ");
    await expect(readFile(join(directory, FILES.vault))).rejects.toThrow();
    const result = await guiAction({ action: "create", password: phrase, confirmation: phrase, consent: true }, directory);
    wallet = (result as { wallet: PublicWallet }).wallet;
    expect(JSON.stringify(result)).not.toMatch(/privateKey|keystore|ciphertext/);
    expect(await readJsonFile(directory, FILES.metadata)).toEqual(wallet);
    const stored = await readFile(join(directory, FILES.vault), "utf8"); expect(stored).not.toContain(phrase); expect(stored).toContain("scrypt");
  });
  it("cannot overwrite vaults and allows password retry", async () => {
    await expect(guiAction({ action: "create", password: phrase, confirmation: phrase, consent: true }, directory)).rejects.toThrow("Existing file");
    await expect(guiAction({ action: "check", password: "wrong" }, directory)).rejects.toThrow("Incorrect passphrase");
    expect(await guiAction({ action: "check", password: phrase }, directory)).toMatchObject({ wallet });
  });
  it("creates and checks an encrypted backup, never replacing it", async () => {
    await guiAction({ action: "backup", password: phrase }, directory);
    await guiAction({ action: "check-backup", password: phrase }, directory);
    await expect(guiAction({ action: "backup", password: phrase }, directory)).rejects.toThrow();
    const recovery = join(directory, "recovery"); await mkdir(recovery);
    await writeJsonFile(recovery, "vault-backup.json", await readJsonFile(directory, "vault-backup.json"));
    expect(await guiAction({ action: "restore", password: phrase, consent: true }, recovery)).toMatchObject({ wallet });
    expect(await readJsonFile(recovery, FILES.metadata)).toEqual(wallet);
  });
  it("displays all exact transfer fields and requires explicit approval of that fingerprint", async () => {
    request = await prepareRequest(wallet, Wallet.createRandom().address, "0.0001", rpc);
    await writeJsonFile(directory, FILES.request, request);
    expect(await guiAction({ action: "review" }, directory)).toMatchObject({ review: { recipient: request.to, amount: "0.0001 ETH", nonce: request.nonce, deadlineUTC: request.expiresAt, fingerprint: request.fingerprint } });
    await expect(guiAction({ action: "sign", password: phrase, fingerprint: "0x" + "11".repeat(32), consent: true }, directory)).rejects.toThrow("Request changed");
    await expect(guiAction({ action: "sign", password: phrase, fingerprint: request.fingerprint, consent: false }, directory)).rejects.toThrow();
    await expect(guiAction({ action: "sign", password: "wrong", fingerprint: request.fingerprint, consent: true }, directory)).rejects.toThrow("Incorrect passphrase");
  });
  it("exports a cryptographically verified exact response, not a private key", async () => {
    const result = await guiAction({ action: "sign", password: phrase, fingerprint: request.fingerprint, consent: true }, directory);
    const response = verifyResponse(await readJsonFile(directory, FILES.response), request, wallet);
    expect(result).toMatchObject({ hash: response.transactionHash });
    expect(JSON.stringify(result)).not.toMatch(/privateKey|keystore|rawSignedTransaction/);
  });
  it("fails closed if offline checks fail, including public operations", async () => {
    vi.mocked(assertOfflineEnvironment).mockRejectedValueOnce(new Error("Network addresses detected. Signing is disabled."));
    await expect(guiAction({ action: "status" }, directory)).rejects.toThrow("Network addresses");
    expect(safeGuiError(new Error("secret-key-example"))).not.toContain("secret-key-example");
    await expect(guiAction({ action: "check", password: phrase, directory: "C:/" }, directory)).rejects.toThrow();
  });
  it("persists only a bounded wallet/request/attempt and rejects altered sessions", () => {
    const values = new Map<string, string>(); const storage = { setItem: (k: string, v: string) => values.set(k, v), getItem: (k: string) => values.get(k) ?? null };
    saveManualSession(storage, { wallet, request, attempt: { hash: "0x" + "aa".repeat(32), state: "unknown" } });
    expect(readManualSession(storage.getItem(MANUAL_SESSION)!)).toMatchObject({ wallet, request, attempt: { state: "unknown" } });
    expect(() => readManualSession(JSON.stringify({ wallet, request: { ...request, to: Wallet.createRandom().address } }))).toThrow();
    expect(() => readManualSession(JSON.stringify({ wallet, request, password: phrase }))).toThrow();
    expect(() => saveManualSession({ setItem() {}, getItem() { return null; } }, { wallet, request })).toThrow("Could not save");
  });
});
