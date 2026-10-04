import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { FILES, publicWallet, validateRequest, verifyResponse, type PublicWallet, type SignedResponseV2, type TransferRequest } from "../core/protocol";
import { readJsonFile, writeJsonFile } from "../core/files";

export type Volume = { root: string; wallet: PublicWallet };
export type Phase = "idle" | "awaiting-removal" | "awaiting-reconnect" | "awaiting-offline" | "paused" | "awaiting-return-removal" | "awaiting-return" | "signed" | "error";
export type Pending = { wallet: PublicWallet; request: TransferRequest };
export type CompanionStatus = {
  version: 2; nativeReady: boolean; phase: Phase; message: string; connected: boolean;
  volumes: PublicWallet[]; wallet: PublicWallet | null; request: TransferRequest | null; response: SignedResponseV2 | null;
};

// Event injection is a constructor boundary for unit tests, never an HTTP endpoint.
export class CompanionEngine {
  private volumes = new Map<string, Volume>();
  private pending: Pending | null = null;
  private owner: string | null = null;
  private selected: PublicWallet | null = null;
  private response: SignedResponseV2 | null = null;
  private phase: Phase = "idle";
  private message = "Connect a provisioned USB. Create its vault in the offline environment first.";
  nativeReady = false;
  constructor(private stateDirectory: string) {}

  async restore(): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    try {
      const input = await readJsonFile(this.stateDirectory, "pending.json") as { request?: unknown; wallet?: unknown };
      if (!input.request || !input.wallet) return;
      const wallet = publicWallet(input.wallet), request = validateRequest(input.request, Date.now(), false);
      if (request.deviceId !== wallet.deviceId || request.from !== wallet.address) throw new Error("Invalid saved intent.");
      this.pending = { wallet, request }; this.selected = wallet; this.phase = "paused";
      this.message = "Pending request restored. Review it and explicitly resume. Startup never submits a payment.";
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.message = "Saved intent could not be restored. Do not submit old response files; reconcile activity first."; }
  }

  status(): CompanionStatus {
    const candidates = [...this.volumes.values()].filter(v => v.wallet.deviceId === this.selected?.deviceId);
    return { version: 2, nativeReady: this.nativeReady, phase: this.phase, message: this.message, connected: candidates.length === 1,
      volumes: [...this.volumes.values()].map(v => v.wallet), wallet: this.selected, request: this.pending?.request ?? null, response: this.response };
  }

  private async persist(): Promise<void> { await writeJsonFile(this.stateDirectory, "pending.json", this.pending ?? {}, true); }

  select(deviceId: string): void {
    if (this.pending) throw new Error("Cancel or finish the pending request before switching vaults.");
    const matches = [...this.volumes.values()].filter(v => v.wallet.deviceId === deviceId);
    if (matches.length !== 1) throw new Error("Vault is missing or duplicate vault identifiers are connected.");
    this.selected = matches[0].wallet;
  }

  async prepare(input: unknown, owner: string): Promise<void> {
    if (!this.nativeReady) throw new Error("Native USB observer is unavailable.");
    if (this.pending) throw new Error("A request is already active. Cancel it before preparing another.");
    if (!this.selected || !this.status().connected) throw new Error("Connect and select exactly one provisioned USB.");
    const request = validateRequest(input);
    if (request.from !== this.selected.address || request.deviceId !== this.selected.deviceId) throw new Error("Request does not match the selected public wallet.");
    this.pending = { request, wallet: this.selected }; this.owner = owner; this.response = null;
    this.phase = "awaiting-removal"; this.message = "Safely eject, unplug, and reconnect this USB to arm and export the exact request.";
    try { await this.persist(); }
    catch (error) { this.pending = null; this.owner = null; this.phase = "error"; this.message = "Could not save intent. Nothing is armed; check companion storage."; throw error; }
  }

  async resume(owner: string): Promise<void> {
    if (!this.nativeReady) throw new Error("Native USB observer is unavailable.");
    if (!this.pending) throw new Error("No pending request to resume.");
    if (this.owner && this.owner !== owner) throw new Error("Another paired session owns this request. Close it or restart the companion to recover safely.");
    validateRequest(this.pending.request);
    this.owner = owner; this.response = null;
    this.phase = this.status().connected ? "awaiting-return-removal" : "awaiting-return";
    this.message = this.status().connected ? "Remove the USB, then reconnect to import the offline signature." : "Reconnect the offline-signed USB. Only this exact request can be submitted.";
  }

  async cancel(owner: string): Promise<void> {
    if (this.owner && this.owner !== owner) throw new Error("Only the owning session can cancel this workflow.");
    this.pending = null; this.owner = null; this.response = null; this.phase = "idle";
    this.message = "Workflow cleared. A signature already created offline is not revoked; reconcile its nonce before another payment.";
    await this.persist();
  }

  async event(type: "scan" | "arrived" | "removed", roots: string[]): Promise<void> {
    if (type === "removed") {
      const selectedRemoved = roots.some(root => this.volumes.get(root)?.wallet.deviceId === this.selected?.deviceId);
      for (const root of roots) this.volumes.delete(root);
      if (selectedRemoved) {
        if (this.phase === "awaiting-removal") this.phase = "awaiting-reconnect";
        if (this.phase === "awaiting-return-removal") this.phase = "awaiting-return";
      }
      return;
    }
    for (const root of roots) {
      let wallet: PublicWallet;
      try { wallet = publicWallet(await readJsonFile(join(root, "DriveKey"), FILES.metadata)); }
      catch { this.message = "A removable volume has no readable v2 public metadata yet. Finish offline setup or wait for the volume to mount."; continue; }
      const wasPresent = this.volumes.has(root);
      this.volumes.set(root, { root, wallet });
      if (!this.selected && this.volumes.size === 1) this.selected = wallet;
      if (type !== "arrived" || wasPresent || !this.pending || wallet.deviceId !== this.pending.wallet.deviceId) continue;
      if (!this.status().connected || wallet.address !== this.pending.wallet.address) { this.phase = "error"; this.message = "Duplicate or changed public wallet metadata. No request was processed."; continue; }
      try {
        if (this.phase === "awaiting-reconnect") {
          validateRequest(this.pending.request);
          await writeJsonFile(join(root, "DriveKey"), FILES.request, this.pending.request, true);
          this.phase = "awaiting-offline";
          this.message = "Request exported and read-back verified. Boot the USB offline, review and sign, then fully shut down and return to Windows.";
        } else if (this.phase === "awaiting-return") {
          this.response = verifyResponse(await readJsonFile(join(root, "DriveKey"), FILES.response), this.pending.request, this.pending.wallet);
          this.phase = "signed"; this.message = "Offline signature verified. The website will preflight this exact transfer before submission.";
        }
      } catch { this.phase = "error"; this.response = null; this.message = "USB request/response was unreadable, expired, or mismatched. Nothing was submitted. Review the request and resume to retry."; }
    }
  }
}
