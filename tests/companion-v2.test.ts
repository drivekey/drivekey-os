import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { get } from "node:http";
import { Wallet } from "ethers";
import { CompanionEngine } from "../companion/engine";
import { createCompanionServer } from "../companion/server";
import { FILES, prepareRequest, type Rpc } from "../core/protocol";
import { writeJsonFile } from "../core/files";
import { createOfflineVault, signOfflineVault, type OfflineVault } from "../offline-signer/vault";

let root: string, vault: OfflineVault;
const phrase = "unfunded companion fixture passphrase";
const rpc: Rpc = async m => ({ eth_chainId: "0x1237", eth_getTransactionCount: "0x0", eth_estimateGas: "0x186a0", eth_getBlockByNumber: { baseFeePerGas: "0xf4240" }, eth_maxPriorityFeePerGas: "0x0", eth_getCode: "0x", eth_getBalance: "0xde0b6b3a7640000" })[m];
beforeAll(async () => {
  const parent = resolve("outputs/test-fixtures"); await mkdir(parent, { recursive: true }); root = await mkdtemp(join(parent, "companion-"));
  vault = await createOfflineVault(phrase);
});
afterAll(async () => { if (root.startsWith(resolve("outputs/test-fixtures") + "\\")) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const dir = await mkdtemp(join(root, "case-")), volume = join(dir, "volume"), state = join(dir, "state");
  await mkdir(join(volume, "DriveKey"), { recursive: true });
  await writeJsonFile(join(volume, "DriveKey"), FILES.metadata, vault.public);
  const engine = new CompanionEngine(state); await engine.restore(); engine.nativeReady = true;
  await engine.event("scan", [volume]);
  const request = await prepareRequest(vault.public, Wallet.createRandom().address, "0.0001", rpc);
  return { engine, volume, state, request };
}

describe("companion event boundary (isolated directories, not physical USB)", () => {
  it("requires a removal and new arrival; scans/duplicate events do not arm", async () => {
    const {engine, volume, request} = await fixture();
    await engine.prepare(request, "owner");
    await engine.event("scan", [volume]); await engine.event("arrived", [volume]);
    expect(engine.status().phase).toBe("awaiting-removal");
    await engine.event("removed", [volume]); expect(engine.status().phase).toBe("awaiting-reconnect");
    await engine.event("arrived", [volume]); expect(engine.status().phase).toBe("awaiting-offline");
    expect(JSON.parse(await readFile(join(volume, "DriveKey", FILES.request), "utf8"))).toEqual(request);
    await engine.event("arrived", [volume]); expect(engine.status().phase).toBe("awaiting-offline");
  });
  it("restores paused, requires explicit resume and a fresh return event", async () => {
    const {engine, volume, state, request} = await fixture();
    await engine.prepare(request, "owner"); await engine.event("removed", [volume]); await engine.event("arrived", [volume]);
    const signed = await signOfflineVault(vault, phrase, request);
    await writeJsonFile(join(volume, "DriveKey"), FILES.response, signed);
    const restarted = new CompanionEngine(state); await restarted.restore(); restarted.nativeReady = true;
    await restarted.event("scan", [volume]); expect(restarted.status().phase).toBe("paused"); expect(restarted.status().response).toBeNull();
    await restarted.resume("new-session"); expect(restarted.status().phase).toBe("awaiting-return-removal");
    await restarted.event("removed", [volume]); await restarted.event("arrived", [volume]);
    expect(restarted.status().phase).toBe("signed"); expect(restarted.status().response).toEqual(signed);
  });
  it("blocks another owner and parallel preparation", async () => {
    const {engine, request} = await fixture(); await engine.prepare(request, "owner");
    await expect(engine.prepare(request, "other")).rejects.toThrow("already active");
    await expect(engine.resume("other")).rejects.toThrow("owns");
    await expect(engine.cancel("other")).rejects.toThrow("owning");
  });
  it("rejects missing signatures and duplicate vault identities", async () => {
    const {engine, volume, state, request} = await fixture(); await engine.prepare(request, "owner");
    await engine.resume("owner"); await engine.event("removed", [volume]); await engine.event("arrived", [volume]);
    expect(engine.status().phase).toBe("error"); expect(engine.status().response).toBeNull();
    await engine.cancel("owner");
    const clone = join(state, "clone"); await mkdir(join(clone, "DriveKey"), {recursive:true});
    await writeJsonFile(join(clone, "DriveKey"), FILES.metadata, vault.public); await engine.event("scan", [clone]);
    await expect(engine.prepare(request, "owner")).rejects.toThrow("exactly one");
  });
  it("fails closed when native watcher is unavailable", async () => {
    const {engine, request} = await fixture(); engine.nativeReady = false;
    await expect(engine.prepare(request, "owner")).rejects.toThrow("observer");
  });
  it("recognizes the same public vault after a drive-root change", async () => {
    const {engine,volume,request}=await fixture();await engine.prepare(request,"owner");await engine.event("removed",[volume]);
    const changed=volume+"-new-letter";await rename(volume,changed);await engine.event("arrived",[changed]);
    expect(engine.status().phase).toBe("awaiting-offline");expect(engine.status().wallet).toEqual(vault.public);
  });
  it("rejects an expired restored request without enabling the return gesture", async () => {
    const {engine,request}=await fixture();await engine.prepare(request,"owner");
    const original=Date.now;Date.now=()=>Date.parse(request.expiresAt)+1;
    try{await expect(engine.resume("owner")).rejects.toThrow("expired");expect(engine.status().phase).toBe("awaiting-removal");}finally{Date.now=original;}
  });
});

describe("real loopback HTTP pairing boundary", () => {
  it("rejects unpaired/bad origins/host, validates consent, and never exposes a simulation endpoint", async () => {
    const {engine, request} = await fixture(); let code = "";
    const origin = "http://127.0.0.1:3000", port = 47834;
    const { server } = createCompanionServer(engine, origin, port, value => { code = value; });
    await new Promise<void>(resolve => server.listen(port,"127.0.0.1",resolve));
    const query = (path: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, options);
    try {
      expect((await query("/v1/status", { headers:{Origin:origin} })).status).toBe(401);
      expect((await query("/v1/status", { headers:{Origin:"https://attacker.invalid"} })).status).toBe(403);
      // fetch normalizes Host; use raw HTTP to exercise the rebinding defense.
      const badHostStatus = await new Promise<number|undefined>((resolve,reject)=>{const req=get({hostname:"127.0.0.1",port,path:"/health",headers:{Host:"attacker.invalid"}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);});
      expect(badHostStatus).toBe(403);
      const paired = await query("/v1/pair", { method:"POST", headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({code}) });
      const {token} = await paired.json(); expect(token).toMatch(/^[0-9a-f]{64}$/);
      const headers = {Origin:origin,Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
      expect((await query("/v1/prepare", {method:"POST",headers,body:JSON.stringify({request,consent:false})})).status).toBe(400);
      expect((await query("/v1/prepare", {method:"POST",headers,body:JSON.stringify({request,consent:true})})).status).toBe(200);
      expect((await query("/simulate", {method:"POST",headers,body:"{}"})).status).toBe(400);
      const status = await (await query("/v1/status", {headers})).json(); expect(status).not.toHaveProperty("keystore");
      expect((await query("/v1/prepare", {method:"POST",headers,body:" ".repeat(33_000)})).status).toBe(400);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
