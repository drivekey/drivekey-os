import { beforeAll, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import { walletAction } from "../core/service";
import { createOfflineVault, signOfflineVault, type OfflineVault } from "../offline-signer/vault";
import { prepareRequest, type Rpc, type SignedResponseV2, type TransferRequest } from "../core/protocol";

let vault: OfflineVault, request: TransferRequest, response: SignedResponseV2;
const rpc: Rpc = async m => ({ eth_call:"0x", eth_chainId: "0x1237", eth_getTransactionCount: "0x0", eth_estimateGas: "0x186a0", eth_getBlockByNumber: { baseFeePerGas: "0xf4240" }, eth_maxPriorityFeePerGas: "0x0", eth_getCode: "0x", eth_getBalance: "0xde0b6b3a7640000", eth_getTransactionByHash:null, eth_getTransactionReceipt:null })[m];
beforeAll(async () => { const phrase = "unfunded service fixture long phrase"; vault = await createOfflineVault(phrase); request = await prepareRequest(vault.public, Wallet.createRandom().address,"0.0001",rpc); response = await signOfflineVault(vault,phrase,request); });
const action = () => ({action:"broadcast",wallet:vault.public,request,response,consent:true});
describe("mainnet service with mock transport only", () => {
  it("preflights an exact signature without broadcasting, and detects a changed nonce", async () => {
    let sends = 0;
    const preflight = { action: "preflight", wallet: vault.public, request, response };
    expect(await walletAction(preflight, async (m,p) => { if(m === "eth_sendRawTransaction") sends++; return rpc(m,p); }, true)).toMatchObject({ state: "ready", hash: response.transactionHash, broadcastEnabled: true });
    expect(sends).toBe(0);
    await expect(walletAction(preflight, async (m,p) => m === "eth_getTransactionCount" ? "0x1" : rpc(m,p), true)).rejects.toThrow();
    await expect(walletAction({ ...preflight, response: { ...response, transactionHash: "0x" + "00".repeat(32) } }, rpc, true)).rejects.toThrow();
  });
  it("defaults to no broadcast while verifying real signatures", async () => {
    const methods:string[]=[];
    expect(await walletAction(action(), (m,p)=>{ methods.push(m); return rpc(m,p); })).toMatchObject({state:"verified-only"});
    expect(methods).not.toContain("eth_sendRawTransaction");
  });
  it("submits only the signed bytes after preflight when explicitly enabled", async () => {
    let count=0;
    const result=await walletAction(action(),async(m,p)=>{if(m==="eth_sendRawTransaction"){count++;expect(p).toEqual([response.rawSignedTransaction]);return response.transactionHash;}return rpc(m,p);},true);
    expect(result).toMatchObject({state:"submitted"}); expect(count).toBe(1);
  });
  it("reconciles known hashes without resending or changing nonce", async () => {
    let count=0;
    const result=await walletAction(action(),async(m,p)=>{if(m==="eth_getTransactionByHash")return {hash:response.transactionHash};if(m==="eth_sendRawTransaction") count++;return rpc(m,p);},true);
    expect(result).toMatchObject({alreadyKnown:true});expect(count).toBe(0);
  });
  it("returns uncertain outcome on submission timeout rather than duplicating", async () => {
    expect(await walletAction(action(),async(m,p)=>{if(m==="eth_sendRawTransaction")throw new Error("timeout");return rpc(m,p);},true)).toMatchObject({state:"unknown",hash:response.transactionHash});
  });
  it("does not accept a receipt without matching transaction evidence", async () => {
    expect(await walletAction({action:"status",hash:response.transactionHash,request},async(m,p)=>m==="eth_getTransactionReceipt"?{status:"0x0",blockNumber:"0x10",transactionHash:response.transactionHash}:rpc(m,p))).toMatchObject({state:"pending"});
  });
  it('refuses expiry reached during exact simulation',async()=>{const clock=vi.spyOn(Date,'now');let sends=0;try{await expect(walletAction(action(),async(m,p)=>{if(m==='eth_call')clock.mockReturnValue(Date.parse(request.expiresAt));if(m==='eth_sendRawTransaction')sends++;return rpc(m,p);},true)).rejects.toThrow('expired');expect(sends).toBe(0);}finally{clock.mockRestore();}});
  it("requires explicit consent and strict schema",async()=>{await expect(walletAction({...action(),consent:false},rpc,true)).rejects.toThrow();await expect(walletAction({...action(),privateKey:"forbidden"},rpc)).rejects.toThrow();});
});
